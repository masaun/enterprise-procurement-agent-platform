---
name: agent-skills
description: Teaches an external enterprise agent (e.g. Hermes Agent, OpenClaw, or any A2A/MCP-capable agent) how to buy blockchain services through the Enterprise Procurement Agent at ./app/api/agent — SIWX wallet authentication, A2A/Agent Card discovery, ERC-8004 identity, AP2 commerce metadata, and KeeperHub-gated execution. Use this skill whenever the user asks to move treasury funds into a DeFi protocol, discover yield/service providers, check a procurement task's status, or otherwise act as the "Enterprise" in the procurement workflow.
license: MIT
compatibility: Requires network access to a running instance of this app (default http://localhost:3000) and, for the bundled CLI, Node.js 18+.
metadata:
  author: agentic-commerce-demo
  version: "1.0"
  protocol: A2A, SIWX, ERC-8004, AP2, MCP
---

# Enterprise Procurement Agent — behavior skill

You are acting as (or on behalf of) an **Enterprise** in the workflow below. The
**Procurement Agent** is this app; you reach it exclusively through
`./app/api/agent` (never through the human-facing `/api` routes, which are UI
convenience wrappers around this same surface).

```
Enterprise (you)
    |
    v
Procurement Agent  ./app/api/agent
    |
    +-- SIWX        -> authenticate your wallet            (1)
    +-- ERC-8004    -> identify service providers           (2)
    +-- A2A         -> discover + talk to providers         (3)
    +-- AP2         -> commerce-role metadata attached       (4)
    |
    v
KeeperHub  (policy -> workflow -> wallet -> transaction)     (5)
    |
    v
Blockchain
```

Lucid (steps 1-4) decides **who to buy from**. KeeperHub (step 5) decides
**how to execute**. You only need to drive step 1-4's entrypoints; KeeperHub
runs automatically inside the `procure` entrypoint once a provider is chosen.

## Three ways to talk to this agent

| Surface | When to use it | Entry point |
| --- | --- | --- |
| **A2A / HTTP entrypoints** | You can make raw HTTP calls (most agent frameworks can). This is the ground-truth contract everything else wraps. | `POST /api/agent/entrypoints/:key/invoke` |
| **MCP** | You're an MCP client (Claude Desktop, an MCP-native framework). | `POST /api/agent/mcp` (see `references/mcp-tools.md`) |
| **CLI** | You can shell out to a command but not easily craft HTTP/MCP calls yourself. | `procure` — see `scripts/cli/` |

All three call into the exact same underlying logic, so results are identical
regardless of which one you use. Pick whichever fits how you were invoked.

## Step-by-step

### 1. Discover this agent (optional but recommended)

```
GET /api/agent/.well-known/agent-card.json
```

Returns an A2A Agent Card: this agent's skills (`authenticate`, `discover`,
`policy`, `procure`, `procurement_status`), its ERC-8004 trust metadata, and
its AP2 `shopper` role declaration. Read `references/protocols.md` if you
need to understand any of these fields.

### 2. Authenticate the enterprise wallet (SIWX)

```
POST /api/agent/entrypoints/authenticate/invoke
```

This entrypoint is `siwx: { authOnly: true }` — no payment, just a signature.
The first call returns **401** with a challenge in
`extensions["sign-in-with-x"]`; sign the embedded message with the
enterprise's wallet (EIP-191 `personal_sign`) and retry the same request with
a `SIGN-IN-WITH-X` header carrying the signed payload. Full wire format,
including the exact header encoding, is in `references/protocols.md`.

If you'd rather not implement the challenge/retry loop yourself:

```bash
procure auth
```

or, from your own TypeScript/JS code, use `@lucid-agents/payments`'s
`wrapFetchWithSIWx(fetch, signer)` exactly as `app/lib/demo/enterprise-signer.ts`
does in this repo — the CLI does the same thing.

### 3. Discover candidate providers (A2A)

```
POST /api/agent/entrypoints/discover/invoke
```

Fetches every known provider's Agent Card, resolves its ERC-8004 identity,
and invokes its `quote` skill over A2A. Returns each candidate's protocol,
APY (in basis points), and trust models — with **no purchase and no
KeeperHub call**. Use this to preview before committing to `procure`.

```bash
procure discover
```

### 4. Check the policy you'll be held to (optional)

```
POST /api/agent/entrypoints/policy/invoke
```

Returns the enterprise's KeeperHub-enforced policy: max amount per task,
allowed assets, allowed protocols, and minimum APY. `procure` will reject
anything outside these bounds — check first if you want to explain a
rejection to your user before it happens.

```bash
procure policy
```

### 5. Submit the procurement request

```
POST /api/agent/entrypoints/procure/invoke
```

Body: `{ "input": { "instruction": "...", "asset": "USDC", "amount": "1000000", "minApyBps": 400 } }`

Requires the same SIWX auth as step 2 (send it in the same request via the
challenge/retry cycle — don't call `authenticate` separately first, the
`procure` entrypoint challenges independently). This one call runs the whole
pipeline: A2A discovery -> ERC-8004 identity -> policy evaluation -> AP2
mandate -> KeeperHub `DirectExecutor.checkAndExecute()` (the on-chain
"only if APY > 4%" guard) -> execution receipt. It returns a full
`ProcurementTask` with a `timeline` you can relay back to your user as an
audit trail.

```bash
procure submit \
  --instruction "Move 1,000,000 USDC to an approved lending protocol, but only if APY > 4%." \
  --amount 1000000 --asset USDC --min-apy 4.0
```

Read `task.status`:
- `completed` — executed. See `task.execution.transactionHash` / `executionId`.
- `rejected` — no discovered provider satisfied policy. See `task.policy.reasons`.
- `failed` — KeeperHub's on-chain re-check didn't confirm the condition at broadcast time.

### 6. Poll a task later

```
POST /api/agent/entrypoints/procurement_status/invoke
```
Body: `{ "input": { "taskId": "..." } }`, or `procure task <taskId>`.

## Reference material

- `references/protocols.md` — SIWX wire format, ERC-8004/Agent-Card fields, AP2 roles, how KeeperHub's guarded execution works.
- `references/api-reference.md` — every HTTP entrypoint, request/response shapes, error modes.
- `references/mcp-tools.md` — the MCP tool list, schemas, and trust-boundary notes.
- `references/examples.md` — full worked transcripts (accepted, rejected, MCP-only).

## Using the bundled CLI

```bash
cd agent-skills/scripts/cli && npm install
node bin/procure.js status
```

See `scripts/cli/` and `agent-skills/README.md` for install-as-a-global-command
instructions and the full command/config reference.
