---
name: agent-skills
description: Teaches an external enterprise agent (e.g. Hermes Agent, OpenClaw, or any A2A/MCP-capable agent) how to act as the "Enterprise"'s procurement actor against the Enterprise Procurement Platform at ./app — receive a webhook-dispatched procurement intent, discover providers over A2A, evaluate the enterprise's policy, execute via its own KeeperHub key, record the receipt on-chain (ProcurementRegistry, Base Sepolia), and report back through a SIWX + live on-chain ERC-8004 gate. Use this skill whenever a webhook arrives describing a procurement intent (move treasury funds into a DeFi protocol, etc.), or the user asks to discover yield/service providers, check a procurement task's status, or otherwise act as the "Enterprise" in the procurement workflow.
license: MIT
compatibility: Requires network access to a running instance of ./app (default http://localhost:3000), a wallet with its own KeeperHub org key for real execution (falls back to KeeperHub demo mode), and, for the bundled CLI, Node.js 22.6+ (runs TypeScript directly, no build step).
metadata:
  author: agentic-commerce-demo
  version: "2.0"
  protocol: A2A, SIWX, ERC-8004, AP2, MCP, Webhooks
---

# Enterprise Procurement Agent — behavior skill

You are acting as (or on behalf of) an **Enterprise**'s procurement actor.
**`./app` is a management platform, not the actor** — a human enterprise
admin uses it to set policy and describe procurement intents, which get
pushed to you as a **webhook**. You are the one that actually discovers
providers, decides whether to buy, executes, and records the outcome
on-chain. You reach `./app` exclusively through `./app/api/agent` (never
through its human-facing `/api/*` admin routes, which are the dashboard's
own convenience wrappers).

```
Human enterprise admin
    |
    v
./app (management platform)
    |
    +-- sets/edits policy
    +-- describes a procurement intent
    |
    v
Webhook  ->  YOU (the external agent)
    |
    +-- A2A        -> discover + talk to providers        (./app, read-only)
    +-- policy     -> read the enterprise's current policy (./app, read-only)
    +-- evaluate   -> your own buy/no-buy decision
    +-- KeeperHub  -> execute (your own org key)            (5)
    +-- on-chain   -> record the receipt (your own wallet)  (6)
    +-- report     -> file detail with ./app, SIWX + ERC-8004 gated (7)
    |
    v
Blockchain
```

Discovery and policy are things you *read* from `./app` — it hosts the
market data (mock provider agents) and the enterprise's governance config
(policy), but it never executes anything and never holds your KeeperHub or
treasury credentials. You decide *who to buy from and how to execute*;
`./app` only decides *whether you're allowed to report results* (via a live
on-chain ERC-8004 check) and *shows the enterprise what happened*.

## Three ways to act

| Surface | When to use it | Entry point |
| --- | --- | --- |
| **CLI (`procure act`)** | You received a webhook payload and can shell out. This is the fastest path — it already implements the whole pipeline below. | `procure act --payload <file\|->` (reads the webhook JSON) |
| **CLI (`procure submit`)** | Same pipeline, driven by explicit flags instead of a webhook payload (e.g. testing, or a human-typed instruction). | `procure submit --instruction "..." --amount <n> [--asset USDC] [--min-apy 4.0]` |
| **Raw HTTP + your own KeeperHub/viem code** | You can't shell out, or you're embedding this logic in your own agent runtime. This is the ground-truth contract the CLI wraps — see `references/api-reference.md` and `agent-skills/scripts/cli/src/orchestrate.ts` for the exact sequence to replicate. | `POST /api/agent/entrypoints/:key/invoke` for the read/report steps; `@keeperhub/sdk` + `viem` directly for execution + the on-chain write. |

All paths must end the same way: a `report` call gated by SIWX **and** the
platform's on-chain ERC-8004 allowlist. `discover_providers`/`get_policy`
are also available read-only via MCP (`references/mcp-tools.md`) if you're
an MCP-native client — execution never happens over MCP.

## Prerequisite: get authorized

Before your `report` call (or your on-chain `recordProcurement` write) will
succeed, the enterprise admin must add your wallet to the platform's
allowlist via the dashboard's "Authorized agents" panel, with their wallet
connected there (it must own the target `ProcurementRegistry`). The panel
first runs a **live** ERC-8004 check (`POST /api/agents/verify { address,
agentId }`): your `agentId` must actually resolve, on the ERC-8004 Identity
Registry, to the wallet address you're using — not just a self-declared
claim — then their connected wallet signs `addAuthorizedAgent()` itself.
Give the admin your wallet address and your registered `agentId` first, and
make sure your own `PROCURE_REGISTRY_ADDRESS` matches the registry they
authorized you on (its address is shown in the panel). Until you're
authorized on the *same* registry your agent reports to,
`recordProcurement` reverts on-chain (`NotAuthorizedAgent`) and `report` is
rejected server-side.

> **Natural language (e.g. a human via Telegram):** "Authorize agent 0xabc
> with agentId 42." — this is a step the *enterprise admin* does on the
> dashboard, not something you call yourself.

## Step-by-step

### 1. Receive the intent (webhook)

`./app` dispatches a signed webhook when the admin describes a procurement
intent. Exactly how you receive it depends on which platform you run:

- **Hermes Agent**: you (the operator) already registered a route
  (`hermes webhook subscribe ...`); Hermes renders its `--prompt` template
  against the JSON body and hands you the result to act on.
- **OpenClaw**: you registered a `plugins/webhooks` route; the intent
  arrives folded into a TaskFlow `create_flow` action's `goal` field.
- **Generic**: you receive the documented JSON directly — pipe it straight
  into `procure act --payload -`.

See `references/protocols.md` for exact headers/signatures per platform, so
you can verify the webhook actually came from the enterprise's `./app`
instance before acting on it.

```bash
procure act --payload webhook-payload.json
# or, piped from your own webhook handler:
cat webhook-payload.json | procure act --payload -
```

> **Natural language, if a human just tells you directly instead of a
> webhook arriving:** "Move 1,000,000 USDC to an approved lending protocol,
> but only if APY > 4%." — parse instruction/amount/asset/APY threshold and
> call `procure submit` with them instead.

### 2. Discover this agent (optional but recommended)

```
GET /api/agent/.well-known/agent-card.json
```

Returns an A2A Agent Card: this platform's skills (`authenticate`,
`discover`, `policy`, `report`, `procurement_status`), its ERC-8004 trust
metadata, and its AP2 `shopper` role declaration.

```bash
procure card
```

### 3. Discover candidate providers (A2A, read-only)

```
POST /api/agent/entrypoints/discover/invoke
```

Fetches every known provider's Agent Card, resolves its ERC-8004 identity,
and invokes its `quote` skill over A2A. This is platform-hosted market
data — no purchase, no KeeperHub call, and it happens the same way whether
`procure act`/`submit` calls it or you do it by hand.

```bash
procure discover
```

### 4. Read the policy you'll be held to

```
POST /api/agent/entrypoints/policy/invoke
```

Returns the enterprise's current, admin-editable policy: max amount per
task, allowed assets, allowed protocols, minimum APY. **You** are
responsible for honoring it — evaluate every candidate against it yourself
before executing (`agent-skills/scripts/cli/src/policy.ts`'s
`evaluatePolicy`, a port of the platform's own check).

```bash
procure policy
```

### 5. Evaluate and execute — entirely your own decision, your own credentials

Pick the highest-APY offer that satisfies the policy. Then run KeeperHub's
guarded read-then-write call yourself, using **your own** KeeperHub org key
(`PROCURE_KEEPERHUB_API_KEY`) — `./app` never sees this call or these
credentials:

```
checkAndExecute({
  read: rateContract,               // observe current APY
  condition: { operator: "gte", value: requiredApyBps },
  write: supplyContract,            // only broadcast if the condition holds
})
```

`procure submit`/`act` do this for you via
`agent-skills/scripts/cli/src/keeperhub.ts`. If `PROCURE_KEEPERHUB_API_KEY`
is unset, execution runs in a same-shaped simulated demo mode instead of
touching KeeperHub for real.

### 6. Record the receipt on-chain

```
ProcurementRegistry.recordProcurement(taskId, enterprise, status, asset, amount, apyBps, detailsHash, detailsURI)
```

Called with **your own wallet** (`PROCURE_PRIVATE_KEY`) on Base Sepolia —
this is the durable, platform-independent record of what happened. It
reverts unless your wallet is already on the contract's `authorizedAgents`
allowlist (see "Prerequisite: get authorized" above). `procure submit`/`act`
do this via `agent-skills/scripts/cli/src/registry.ts`; if
`PROCURE_REGISTRY_ADDRESS` is unset, this step is skipped with a warning
(useful for local testing before a contract is deployed).

### 7. Report the outcome

```
POST /api/agent/entrypoints/report/invoke
```

SIWX-signed (same challenge/retry cycle as `authenticate`, using your same
`PROCURE_PRIVATE_KEY`) **and** gated by the platform's live on-chain
ERC-8004 check — if your address isn't on `ProcurementRegistry`'s
allowlist, this call is rejected regardless of the signature. Body: the
full task record you built while executing — `taskId` (same value used
on-chain), `status`, `request`, `timeline`, `selectedProvider`,
`policy`, `execution`. This is what populates the dashboard's activity
history alongside the on-chain receipt.

Read the resulting `task.status`:
- `completed` — executed. See `task.execution.transactionHash` / `executionId`.
- `rejected` — no discovered provider satisfied policy. See `task.policy.reasons`.
- `failed` — KeeperHub's on-chain re-check didn't confirm the condition at broadcast time.

### 8. Poll a task later

```
POST /api/agent/entrypoints/procurement_status/invoke
```
Body: `{ "input": { "taskId": "..." } }`, or `procure task <taskId>`.

> **Natural language:** "What's the status of task 0xabc...?" / "Did the
> USDC move happen yet?"

## Reference material

- `references/protocols.md` — SIWX wire format, ERC-8004/Agent-Card fields, AP2 roles, KeeperHub's guarded execution, and each webhook platform's exact headers/signature scheme.
- `references/api-reference.md` — every HTTP entrypoint, request/response shapes, error modes.
- `references/mcp-tools.md` — the MCP tool list (read-only), schemas, and trust-boundary notes.
- `references/examples.md` — full worked transcripts (accepted, rejected, webhook-triggered).
- [`scripts/cli/README.md`](scripts/cli/README.md) — every `procure` command paired with its raw `curl` equivalent, where one exists (execution and the on-chain write have none — they're local, not HTTP calls to `./app`).

## Using the bundled CLI

```bash
cd agent-skills/scripts/cli && npm install
node bin/procure.ts status
```

See [`scripts/cli/README.md`](scripts/cli/README.md) and `agent-skills/README.md`
for install-as-a-global-command instructions, the full command/config
reference, and how to register a webhook route on your own platform
(Hermes/OpenClaw/generic).

## A runnable example agent that reads this file

[`../agent-demo`](../agent-demo/README.md) is an LLM-driven (via
[OpenRouter](https://openrouter.ai/docs/quickstart)) example of the kind of
agent this skill is written for: it loads only the frontmatter above at
startup, reads everything below once a webhook or natural-language task
matches, reads `references/*.md` on demand, and shells out to the CLI above
to act — playing the same actor/role a real Hermes Agent or OpenClaw
install would.
