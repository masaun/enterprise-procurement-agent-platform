# Protocols this agent speaks

Concrete, observed wire formats — every example below is real output captured
from this app's `@lucid-agents/*` runtime, not a paraphrase of the spec.

## SIWX (Sign-In With X)

SIWX rides on the x402 protocol's extension mechanism, implemented by
`@lucid-agents/payments`. An `authOnly` entrypoint (like `authenticate` and
`procure`) challenges with **401**; a priced entrypoint would use **402**.
This app never uses priced (x402-paid) entrypoints, only `authOnly` ones.

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
This is exactly what `app/lib/demo/enterprise-signer.ts` (the app's own demo
signer) and `agent-skills/scripts/cli/src/siwx.js` (the CLI) both do.

### 3. Retry with the signed proof

The retry carries a `SIGN-IN-WITH-X` header (base64/JSON-encoded payload of
`info` + `address` + `signature`). On success, the entrypoint handler
receives a verified `auth: { scheme: "siwx", address, chainId }` and the
response is a normal `200` with the entrypoint's `output`.

Nonces are single-use — replaying a signed payload, or reusing a nonce across
requests, is rejected. Each authenticated call performs its own fresh
challenge/sign/retry round trip; there is no session token to cache.

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

This procurement agent declares `shopper` (it buys on the enterprise's
behalf); each discovered provider declares `merchant` (it sells a yield
service). The `procure` pipeline logs an `ap2.mandate` timeline event once a
provider is selected, attaching this shopper/merchant role pairing to the
purchase — that's the AP2 "commerce role metadata" box in the architecture
diagram.

## KeeperHub's guarded execution ("only if APY > 4%")

Once Lucid has picked a provider, `app/lib/keeperhub/client.ts` calls
`@keeperhub/sdk`'s `DirectExecutor.checkAndExecute()`:

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
