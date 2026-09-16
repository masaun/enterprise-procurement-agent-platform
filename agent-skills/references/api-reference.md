# API reference — `./app/api/agent`

Base URL: `{APP_PUBLIC_ORIGIN}` (default `http://localhost:3000`). Every route
below is mounted by `@lucid-agents/http` and reachable exactly as listed — no
extra prefix or version segment.

## Discovery

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/agent/.well-known/agent-card.json` | none | A2A Agent Card: skills, ERC-8004 trust, AP2 role, interfaces. |
| GET | `/api/agent/.well-known/agent.json` | none | Legacy alias of the above. |
| GET | `/api/agent/.well-known/oasf-record.json` | none | OASF discovery record (auto-derived from live entrypoints). |
| GET | `/api/agent/health` | none | `{ ok: true }` liveness check. |
| GET | `/api/agent/entrypoints` | none | Lists all entrypoints with their input/output schemas. |

## Entrypoints

All entrypoint calls are `POST /api/agent/entrypoints/:key/invoke` with body
`{ "input": { ... } }`, and return `{ run_id, status, output }` on success.

| Key | SIWX | Extra gate | Input | Output |
| --- | --- | --- | --- | --- |
| `authenticate` | required (auth-only) | none | `{}` | `{ address, chainId, scheme }` |
| `discover` | none | none | `{}` | `{ offers: ProviderOffer[], timeline: TimelineEvent[] }` — platform-hosted market data, unchanged from before. |
| `policy` | none | none | `{}` | `Policy` (see below) — now admin-editable via `PATCH /api/policy` (not an agent-facing route), read-only here. |
| `report` | required (auth-only) | **on-chain**: `auth.address` must be in `ProcurementRegistry.authorizedAgents` | `ProcurementReport` (see below) | The same object, persisted, with `enterpriseAddress` filled in from `auth.address` if you didn't set it |
| `procurement_status` | none | none | `{ taskId: string }` | `ProcurementTask \| { found: false, taskId }` |

**`procure` no longer exists.** It used to run the whole pipeline
server-side; that logic (discover -> evaluate -> execute) now runs on your
own machine (`agent-skills/scripts/cli`), and `report` is what you call
*after* you've already done all of that yourself. A SIWX-protected
entrypoint replies **401** with a challenge on the first, unsigned call —
see `references/protocols.md` for the exact wire format. A `report` call
that's correctly signed but from an address not on the on-chain allowlist
gets a **500** with `code: "internal_error"` and a message naming
`agent_not_authorized` — the SDK doesn't support custom 4xx status codes
from a handler, so check the message text, not just the status code.

### `ProcurementRequest`

```ts
{
  instruction: string;       // natural-language ask, 1-2000 chars
  asset?: string;            // default "USDC"
  amount: string;            // decimal string, e.g. "1000000"
  minApyBps?: number;        // default 400 (== 4.00%)
  allowedProtocols?: string[]; // optional override of the enterprise's protocol allow-list
  network?: string;
}
```

### `Policy`

```ts
{
  maxUsdPerTask: number;
  minApyBps: number;
  allowedAssets: string[];
  allowedProtocols: string[];
}
```

### `ProviderOffer`

```ts
{
  agentId: string;
  name: string;
  protocol: string;
  asset: string;
  network: string;         // CAIP-2, e.g. "eip155:84532"
  apyBps: number;
  cardUrl: string;
  trustModels: string[];
  registration: { agentRegistry: string }; // CAIP-10
  rateContract: { address: string; functionName: string; functionArgs?: string };
  supplyContract: { address: string; functionName: string; argsTemplate: string };
}
```

### `ProcurementReport` (what you POST to `report`)

Loosely validated (`taskId`/`status`/`request` required, everything else
passed through) — you're the one who knows the full shape of what you did.
In practice this is the same object `runProcurementLocally` in
`agent-skills/scripts/cli/src/orchestrate.ts` builds, so just report exactly
what that returns if you're using the CLI's pipeline as a reference:

```ts
{
  taskId: string;             // same value used in ProcurementRegistry.recordProcurement
  status: "completed" | "rejected" | "failed" | "dispatched" | "authenticating" | "discovering" | "evaluating_policy" | "executing";
  request: ProcurementRequest;
  enterpriseAddress?: string; // defaults to auth.address if omitted
  selectedProvider?: ProviderOffer;
  policy?: { allowed: boolean; policy: Policy; reasons: string[] };
  execution?: {
    mode: "direct" | "demo";
    executed: boolean;
    executionId?: string;
    status: string;
    transactionHash?: string;
    condition?: { met: boolean; observedApyBps: number; targetApyBps: number };
  };
  timeline: Array<{ kind: string; at: string; label: string; detail?: object }>;
  createdAt: string;
  updatedAt: string;
  error?: string;
  onChainTransactionHash?: string; // the ProcurementRegistry.recordProcurement tx hash
}
```

### `ProcurementTask` (what `procurement_status` and the dashboard return)

Same shape as `ProcurementReport` above, plus the `"dispatched"` status a
task starts in before any agent has reported back — set by
`POST /api/procurement-intents` (an admin-only route, not part of this
agent-facing contract) the moment the enterprise admin describes an intent
and it's dispatched as a webhook.

Timeline event kinds you'll see across a full run: `webhook.dispatched`,
`identity.resolved`, `a2a.discovered`, `a2a.invoked`, `a2a.selected`,
`ap2.mandate`, `policy.evaluated`, `keeperhub.condition_checked`,
`keeperhub.executed`, `chain.recorded`, `report.received`, `task.completed`,
`task.failed`.

## A2A tasks (async alternative to direct invoke)

Because `a2a()` is installed, every entrypoint is also reachable as an async,
polled task — useful if your agent framework prefers task semantics over a
blocking call:

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/agent/tasks` | Create a task. Same auth rules as direct invoke. |
| GET | `/api/agent/tasks/:taskId` | Read status (requires `Task-Access-Token` header from creation). |
| GET | `/api/agent/tasks` | List your own tasks. |
| POST | `/api/agent/tasks/:taskId/cancel` | Cancel a running task. |
| GET | `/api/agent/tasks/:taskId/subscribe` | SSE stream of task updates. |

Direct invoke (`/entrypoints/:key/invoke`) is simpler and is what the
`procure` CLI and the dashboard both use; A2A tasks are documented here for
frameworks that specifically expect that shape.

## Admin-only routes (`./app/api`, not `./app/api/agent`)

These back the dashboard and are **not** part of the agent-facing
contract — you (the external agent) never call these; a human enterprise
admin does, through the browser.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | UI health check + whether `PROCUREMENT_REGISTRY_ADDRESS` is configured. |
| GET | `/api/providers` | Same discovery as `discover`, plain GET for convenience. |
| GET / PATCH | `/api/policy` | Read/edit the enterprise's policy (the same values `discover`/`policy` entrypoints expose read-only). |
| GET / POST | `/api/procurement-intents` | List pending intents / describe a new one — POST triggers the webhook dispatch. **No execution happens on this route.** |
| GET | `/api/procurement-history` | The dashboard's merged view: on-chain `ProcurementRecorded` receipts + off-chain report detail, keyed by `taskId`. |
| GET / POST | `/api/webhooks/subscribers` | List / register a webhook subscriber (`{name, platform, url, secret}`). |
| DELETE | `/api/webhooks/subscribers/:id` | Remove a subscriber. |
| GET / POST | `/api/agents/authorized` | List authorized agents / run the live ERC-8004 verify + on-chain `addAuthorizedAgent` for a new one. |
| DELETE | `/api/agents/authorized/:address` | Revoke an agent's on-chain authorization. |
