# Worked examples

Real output from this app (`DEMO_MODE=true`, no `KEEPERHUB_API_KEY`). Provider
APYs include a small live jitter (see `app/lib/lucid/mock-providers.ts`), so exact
numbers will differ run to run — the decisions they drive are deterministic
given those numbers.

## 1. Accepted: the use case's own example

```bash
procure submit \
  --instruction "Move 1,000,000 USDC from our treasury to an approved lending protocol, but only if APY > 4%." \
  --amount 1000000 --asset USDC --min-apy 4.0
```

Four providers are discovered over A2A: Aave v3 (3.05%, below threshold),
Compound v3 (5.04%), Morpho (5.53%), and an unlisted Yearn gateway (8.79%,
highest APY but **not** on the protocol allow-list). Policy evaluation
excludes Aave (APY) and Yearn (protocol), leaving Compound and Morpho
eligible; Morpho wins on APY:

```json
{
  "status": "completed",
  "selectedProvider": { "name": "Morpho Gateway Agent", "protocol": "morpho", "apyBps": 553 },
  "policy": { "allowed": true, "reasons": [] },
  "execution": {
    "mode": "demo",
    "executed": true,
    "condition": { "met": true, "observedApyBps": 553, "targetApyBps": 400 },
    "transactionHash": "0x3cf86b44d40b674df054cbf0eddae724e40d8a6edfac2e2cd25200b214ec7903"
  }
}
```

The full response also includes a `timeline` with one entry per step
(`siwx.authenticated`, `identity.resolved` x4, `a2a.invoked` x4,
`a2a.discovered`, `policy.evaluated`, `a2a.selected`, `ap2.mandate`,
`keeperhub.condition_checked`, `keeperhub.executed`, `task.completed`) —
relay this to your user as an audit trail; don't just show the final status.

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
one pass instead of iterating.

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

When `status` is `rejected`, there is no `execution` and no on-chain call was
ever attempted — KeeperHub is never reached unless a provider clears policy
first.

## 4. MCP-only client, no CLI available

```json
// -> tools/call get_policy {}
{"maxUsdPerTask":1000000,"minApyBps":400,"allowedAssets":["USDC"],"allowedProtocols":["aave-v3","compound-v3","morpho"]}

// -> tools/call submit_procurement {"instruction":"...","amount":"1000000","enterpriseAddress":"0x269f..."}
{"taskId":"...","status":"completed", "...": "same shape as example 1"}
```

See `references/mcp-tools.md` for the trust-boundary note on
`enterpriseAddress` in the MCP surface versus the cryptographically verified
SIWX flow used by the HTTP entrypoints and the CLI.
