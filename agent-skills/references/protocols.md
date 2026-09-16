# Protocols this agent speaks

Concrete, observed wire formats — every example below is real output captured
from this platform's `@lucid-agents/*` runtime, not a paraphrase of the spec.
This document also covers the webhook signing schemes for Hermes Agent and
OpenClaw, which trigger you into acting in the first place.

## SIWX (Sign-In With X)

SIWX rides on the x402 protocol's extension mechanism, implemented by
`@lucid-agents/payments`. An `authOnly` entrypoint (like `authenticate` and
`report`) challenges with **401**; a priced entrypoint would use **402**.
This platform never uses priced (x402-paid) entrypoints, only `authOnly` ones.

### 1. Unauthenticated request -> 401 challenge

```json
{
  "x402Version": 2,
  "error": { "code": "auth_required", "message": "Wallet authentication required" },
  "resource": { "url": "http://localhost:3000/api/agent/entrypoints/authenticate/invoke" },
  "accepts": [],
  "extensions": {
    "sign-in-with-x": {
      "info": {
        "domain": "localhost:3000",
        "uri": "http://localhost:3000/api/agent/entrypoints/authenticate/invoke",
        "version": "1",
        "nonce": "b5c19d4d65c0cfe0314cc8436e7f328b",
        "issuedAt": "2026-09-13T04:44:50.537Z",
        "resources": ["http://localhost:3000/api/agent/entrypoints/authenticate/invoke"],
        "expirationTime": "2026-09-13T04:49:50.537Z",
        "statement": "Sign in to authorize the Enterprise Procurement Agent to act on this treasury's behalf."
      },
      "supportedChains": [{ "chainId": "eip155:84532", "type": "eip191" }],
      "schema": { "...": "a JSON Schema for the signed payload, see the raw response" }
    }
  }
}
```

Note `supportedChains[].chainId` is **CAIP-2** (`eip155:84532`), not a bare
chain id. Your signer must report its chain id in the same format when
choosing which `supportedChains` entry to sign for — this is the single most
common integration mistake (a bare `"84532"` will silently fail to match and
you'll just get the 401 back again with no error).

### 2. Build and sign the message

Construct an EIP-4361-shaped message from `info` plus your address and the
matched chain/type, then sign it with `personal_sign` (EIP-191). If you're on
Node/TypeScript, don't hand-roll this — use the same library the server does:

```ts
import { wrapFetchWithSIWx, type SIWxSigner } from "@lucid-agents/payments";

const signer: SIWxSigner = {
  signMessage: (message) => account.signMessage({ message }),
  getAddress: async () => account.address,
  getChainId: async () => "eip155:84532", // must match a supportedChains entry
};

const siwxFetch = wrapFetchWithSIWx(fetch, signer);
await siwxFetch(url, { method: "POST", headers: {...}, body: "..." });
```

`wrapFetchWithSIWx` does the whole 401 -> sign -> retry cycle in one call.
This is exactly what `agent-skills/scripts/cli/src/siwx.ts` does — the same
key (`PROCURE_PRIVATE_KEY`) it uses here is also the wallet
`agent-skills/scripts/cli/src/registry.ts` uses to write the on-chain
receipt, so `auth.address` in a `report` call and the `agent` address in
that call's on-chain `ProcurementRecorded` event are the same address.

### 3. Retry with the signed proof

The retry carries a `SIGN-IN-WITH-X` header (base64/JSON-encoded payload of
`info` + `address` + `signature`). On success, the entrypoint handler
receives a verified `auth: { scheme: "siwx", address, chainId }` and the
response is a normal `200` with the entrypoint's `output`.

Nonces are single-use — replaying a signed payload, or reusing a nonce across
requests, is rejected. Each authenticated call performs its own fresh
challenge/sign/retry round trip; there is no session token to cache.

**A valid signature alone is not enough for `report`.** Beyond SIWX, the
platform separately checks `auth.address` against `ProcurementRegistry`'s
on-chain `authorizedAgents` allowlist (see "The ERC-8004 gate" below) — any
address can produce a valid signature, but only an address the enterprise
admin has explicitly authorized will have its report accepted.

## ERC-8004 identity

Every discoverable provider (and this agent itself) carries ERC-8004 trust
metadata in its Agent Card:

```json
{
  "registrations": [
    { "agentId": "1003", "agentRegistry": "eip155:84532:0x71b4d3271ff6888e7fc43fd7321a503ff738c99" }
  ],
  "trustModels": ["feedback", "tee-attestation"]
}
```

`agentRegistry` is a CAIP-10 address of the ERC-8004 Identity Registry
contract (`namespace:chainId:address`). `trustModels` says what kind of
attestation backs this agent's identity (`feedback` = reputation from past
tasks, `inference-validation` = re-run/validated outputs, `tee-attestation` =
hardware-attested execution). This app resolves identity in one of two modes
(see `app/lib/lucid/agent.ts`):

- **Live**: with `AGENT_DOMAIN` + `RPC_URL` + `CHAIN_ID` set, `@lucid-agents/identity`
  discovers `/.well-known/agent-registration.json` on that domain and verifies
  the token on-chain via `ownerOf`/`tokenURI`.
- **Static** (this repo's default): a self-declared `trust` config with no RPC
  calls — enough to advertise identity metadata without a deployed registry.

This is the platform describing *its own* identity, and (via `discover`)
resolving each *provider's* identity — neither one verifies who is calling
*in*. That's a separate, new mechanism:

### The ERC-8004 gate (inbound — you, the calling agent)

`app/lib/identity/gate.ts` verifies an inbound caller's identity, live,
against the real ERC-8004 registries on Base Sepolia — no ready-made
"verify this caller" function exists in `@lucid-agents/identity`, so this
composes the SDK's raw registry-client primitives:

```ts
const identityRegistry = createIdentityRegistryClient({ address, chainId, publicClient });
const onChainWallet = await identityRegistry.getAgentWallet(agentId);
// reject unless onChainWallet === the SIWX-authenticated address

const reputationRegistry = createReputationRegistryClient({ address, chainId, publicClient, identityRegistryAddress });
const summary = await reputationRegistry.getSummary(BigInt(agentId)); // informational only
```

This runs once, when the enterprise admin adds you via the dashboard's
"Authorized agents" panel (`POST /api/agents/authorized { address, agentId }`)
— your `agentId` must actually resolve on-chain to the wallet address you
gave. On success, the platform calls
`ProcurementRegistry.addAuthorizedAgent(address)` (`./contracts`), which is
what your later `recordProcurement` and `report` calls are checked against.
This is a one-time setup step per agent wallet, not something you do per
task.

## AP2 (Agent Payments Protocol) commerce roles

The Agent Card's `capabilities.extensions` carries an AP2 declaration:

```json
{
  "uri": "https://github.com/google-agentic-commerce/ap2/tree/v0.1",
  "description": "Buys DeFi yield services on behalf of an enterprise treasury.",
  "required": false,
  "params": { "roles": ["shopper"] }
}
```

This procurement platform declares `shopper` (the enterprise's agent buys on
its behalf); each discovered provider declares `merchant` (it sells a yield
service). `agent-skills/scripts/cli/src/orchestrate.ts` logs an
`ap2.mandate` timeline event once you select a provider, attaching this
shopper/merchant role pairing to the purchase — that's the AP2 "commerce
role metadata" box in the architecture diagram. (Previously this was logged
server-side; it moved here along with the rest of the buy/no-buy decision.)

## KeeperHub's guarded execution ("only if APY > 4%")

Once you've picked a provider, `agent-skills/scripts/cli/src/keeperhub.ts`
calls `@keeperhub/sdk`'s `DirectExecutor.checkAndExecute()` — **using your
own KeeperHub org key (`PROCURE_KEEPERHUB_API_KEY`), not the platform's**:

1. **Read**: call the provider's rate contract (view function) for the
   current APY, in basis points.
2. **Evaluate**: compare against a condition (`{ operator: "gte", value: "400" }`
   for "APY > 4%").
3. **Write**: only if the condition holds, broadcast the guarded action (the
   USDC `supply()`/`deposit()` call into the protocol) — inside KeeperHub's
   managed execution path (policy, wallet, nonce/gas management).

This is a single atomic KeeperHub call, not an agent-side read followed by a
separate unguarded write — the condition is re-checked on-chain at broadcast
time, independent of whatever APY the A2A `quote` skill reported a moment
earlier.

## ProcurementRegistry — the on-chain receipt (Base Sepolia)

After execution, `agent-skills/scripts/cli/src/registry.ts` writes a
compact receipt to `ProcurementRegistry.sol` (`./contracts`) using **your
own wallet** (`PROCURE_PRIVATE_KEY`):

```solidity
function recordProcurement(
    bytes32 taskId, address enterprise, Status status,
    string calldata asset, uint256 amount, uint32 apyBps,
    bytes32 detailsHash, string calldata detailsURI
) external; // reverts unless authorizedAgents[msg.sender]
```

`detailsHash` is `keccak256` of the full JSON task record you also send to
`report` — so anyone can verify the off-chain detail matches what you
committed to on-chain. This call **reverts** unless your wallet is already
on the contract's `authorizedAgents` allowlist (see "The ERC-8004 gate"
above) — there is no way around getting authorized first. The emitted
`ProcurementRecorded` event is what `app/lib/chain/registry.ts` reads to
build the dashboard's activity history; nothing about rendering that history
depends on your `report` call succeeding, though `report` is what supplies
the rich timeline/policy detail alongside it.

## Webhook signing (how you receive an intent)

`./app` dispatches a procurement intent as a signed outbound webhook to
whichever subscriber URL the enterprise admin registered for you. Verify the
signature before acting — anyone who can guess your webhook URL could
otherwise inject a fake intent.

| Platform | Verify | Payload |
| --- | --- | --- |
| **Hermes Agent** | `X-Webhook-Signature-V2: sha256=<hex>` — HMAC-SHA256 over `` `${X-Webhook-Timestamp}.${rawBody}` `` using the secret you gave the admin. Reject if the timestamp is stale. | Flat JSON: `{event_type, taskId, instruction, asset, amount, minApyBps, allowedProtocols, policy, enterpriseId}`. Hermes itself also renders your own `--prompt` template against these fields before you see it. |
| **OpenClaw** | `Authorization: Bearer <secret>` — exact match against the secret you gave the admin. | A TaskFlow `create_flow` action: `{"action":"create_flow","goal":"<instruction + taskId/asset/amount/minApyBps folded into the string>","status":"queued","notifyPolicy":"done_only"}` — OpenClaw's endpoint rejects any other shape, so structured fields are folded into `goal` rather than sent alongside it. |
| **Generic** | `X-Procurement-Signature-256: sha256=<hex>` — HMAC-SHA256 over the raw body, GitHub-style. | The full documented schema: `{taskId, instruction, asset, amount, minApyBps, allowedProtocols, policy, enterpriseId}` — exactly what `procure act` expects on stdin/file. |

See `app/lib/webhooks/dispatch.ts` for the exact payload-building/signing
code these are mirrored from.
