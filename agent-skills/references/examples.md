# Worked examples

Real output from `procure submit` run against a local `./app` instance with
no `PROCURE_KEEPERHUB_API_KEY` / `PROCURE_PRIVATE_KEY` / `PROCUREMENT_REGISTRY_ADDRESS`
configured (KeeperHub demo mode, throwaway signer, on-chain write skipped —
this is the CLI's own graceful-degradation path, described in
`agent-skills/README.md`). Provider APYs include a small live jitter (see
`app/lib/lucid/mock-providers.ts`), so exact numbers will differ run to run
— the decisions they drive are deterministic given those numbers.

## 1. Accepted: the use case's own example

```bash
procure submit \
  --instruction "Move 1,000,000 USDC from our treasury to an approved lending protocol, but only if APY > 4%." \
  --amount 1000000 --asset USDC --min-apy 4.0
```

Four providers are discovered over A2A: Aave v3 (3.05%, below threshold),
Compound v3 (5.04%), Morpho (5.49%), and an unlisted Yearn gateway (8.78%,
highest APY but **not** on the protocol allow-list). Policy evaluation
excludes Aave (APY) and Yearn (protocol), leaving Compound and Morpho
eligible; Morpho wins on APY:

```json
{
  "taskId": "0x87312373bd4d428e98fb4cbc815f2e430f400da837f190db98142e1ece75d641",
  "status": "completed",
  "enterpriseAddress": "0xa168bEe5A267E378667Cf5A99639847cf1E0dc0B",
  "selectedProvider": { "name": "Morpho Gateway Agent", "protocol": "morpho", "apyBps": 549 },
  "policy": { "allowed": true, "reasons": [] },
  "execution": {
    "mode": "demo",
    "executed": true,
    "condition": { "met": true, "observedApyBps": 549, "targetApyBps": 400 },
    "transactionHash": "0xc654457692274a5464a0262687398cbd9116c40fe5e608596d1380aa82aff237"
  }
}
```

This is the CLI's own local view, printed before its `report` call — since
no `PROCUREMENT_REGISTRY_ADDRESS` was configured on the platform side
either in this run, `report` was rejected (`registry_not_configured`, a
warning on stderr) and the task never made it into the dashboard. With a
real deployment, `taskId` also identifies the matching
`ProcurementRegistry.ProcurementRecorded` on-chain event, and a successful
`report` call appends two more events server-side (see below).

The full response includes a `timeline` with one entry per step —
`identity.resolved` x4, `a2a.invoked` x4, `a2a.discovered`,
`policy.evaluated`, `a2a.selected`, `ap2.mandate`,
`keeperhub.condition_checked`, `keeperhub.executed`, `task.completed`.
Once `report` succeeds, `./app` appends `erc8004.gate_checked` (confirming
your address against the on-chain allowlist) and `report.received` before
persisting the task for the dashboard — relay the whole timeline to your
user as an audit trail, not just the final status.

## 2. Rejected: amount over the policy cap

```bash
procure submit --instruction "Move 5M USDC to any approved lending protocol." --amount 5000000 --min-apy 4.0
```

```json
{
  "status": "rejected",
  "policy": {
    "allowed": false,
    "reasons": [
      "Requested amount 5,000,000 USDC exceeds the policy cap of 1,000,000 per task.",
      "Observed APY 3.05% is below the required 4.00%."
    ]
  }
}
```

`reasons` accumulates every violated rule for the best-scoring candidate, not
just the first one — surface all of them so your user can fix the request in
one pass instead of iterating. A rejected task still gets recorded on-chain
(`status: rejected`) and reported, same as a completed one — the platform's
activity history shows every attempt, not just successful ones.

## 3. Rejected: no provider clears the bar

```bash
procure submit --instruction "Move 100 USDC to any protocol with APY > 20%." --amount 100 --min-apy 20
```

```json
{
  "status": "rejected",
  "error": "No discovered provider satisfies the enterprise policy (amount cap, asset, protocol allow-list, or APY threshold).",
  "policy": { "allowed": false, "reasons": ["Observed APY 3.05% is below the required 20.00%."] }
}
```

When `status` is `rejected`, there is no `execution` and no KeeperHub call
was ever attempted — `evaluatePolicy()` runs locally in
`agent-skills/scripts/cli/src/orchestrate.ts` before KeeperHub is ever
reached, exactly as it did server-side before this migration.

## 4. Triggered by a webhook, not a CLI flag

If `./app`'s dashboard dispatched this intent (rather than you typing
`procure submit` by hand), the generic-platform payload looks like:

```json
{
  "taskId": "task-abc123",
  "instruction": "Move 1,000,000 USDC to an approved lending protocol, but only if APY > 4%.",
  "asset": "USDC",
  "amount": "1000000",
  "minApyBps": 400,
  "allowedProtocols": [],
  "policy": { "maxUsdPerTask": 1000000, "minApyBps": 400, "allowedAssets": ["USDC"], "allowedProtocols": ["aave-v3", "compound-v3", "morpho"] },
  "enterpriseId": "default-enterprise"
}
```

signed with `X-Procurement-Signature-256: sha256=<hmac>` (see
`references/protocols.md`). You'd verify the signature, then:

```bash
echo '<the received JSON>' | procure act --payload -
```

which runs the identical pipeline as example 1 above — `procure act` just
sources its `ProcurementRequest` from the payload's `instruction`/`asset`/
`amount`/`minApyBps` fields instead of CLI flags.

## 5. MCP-only client (read-only)

```json
// -> tools/call get_policy {}
{"maxUsdPerTask":1000000,"minApyBps":400,"allowedAssets":["USDC"],"allowedProtocols":["aave-v3","compound-v3","morpho"]}

// -> tools/call discover_providers {}
{"offers":[{"name":"Aave v3 Gateway Agent","protocol":"aave-v3","apyBps":305}, "..."],"count":4}
```

MCP tools are read-only now (`references/mcp-tools.md`) — there is no
`submit_procurement`-over-MCP example anymore. Execute via `procure submit`/
`procure act`, which call KeeperHub and write on-chain directly, or make the
HTTP `report` call yourself if you're not using the CLI.
