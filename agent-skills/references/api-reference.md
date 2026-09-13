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

| Key | SIWX | Input | Output |
| --- | --- | --- | --- |
| `authenticate` | required (auth-only) | `{}` | `{ address, chainId, scheme }` |
| `discover` | none | `{}` | `{ offers: ProviderOffer[], timeline: TimelineEvent[] }` |
| `policy` | none | `{}` | `Policy` (see below) |
| `procure` | required (auth-only) | `ProcurementRequest` (see below) | `ProcurementTask` (see below) |
| `procurement_status` | none | `{ taskId: string }` | `ProcurementTask \| { found: false, taskId }` |

A SIWX-protected entrypoint replies **401** with a challenge on the first,
unsigned call — see `references/protocols.md` for the exact wire format and
how to complete it.

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
}
```

### `ProcurementTask`

```ts
{
  taskId: string;
  status: "authenticating" | "discovering" | "evaluating_policy" | "executing"
        | "completed" | "rejected" | "failed";
  request: ProcurementRequest;
  enterpriseAddress?: string;
  selectedProvider?: ProviderOffer;
  policy?: { allowed: boolean; policy: Policy; reasons: string[] };
  execution?: {
    mode: "direct" | "workflow" | "demo";
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
}
```

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

Direct invoke (`/entrypoints/:key/invoke`) is simpler and is what this app's
own UI, demo routes, and CLI all use; A2A tasks are documented here for
frameworks that specifically expect that shape.

## Non-agent, UI-only convenience routes (`./app/api`, not `./app/api/agent`)

These exist for the browser dashboard and are **not** part of the
agent-facing contract — an external agent should use the entrypoints above
instead, so behavior stays identical across every surface.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | UI health check. |
| GET | `/api/providers` | Same discovery as `discover`, plain GET for convenience. |
| POST | `/api/demo/authenticate` | Runs SIWX auth using the bundled demo signer. |
| POST | `/api/demo/procure` | Runs `procure` using the bundled demo signer. |
| GET | `/api/demo/tasks/:taskId` | Reads a task straight from the store. |
