# `procure` — CLI for the Enterprise Procurement Agent's actor

A small dependency-light Node CLI that is now the **actor**, not just an
HTTP client: `procure submit`/`act` read discovery and policy from
`./app` (the management platform), then evaluate policy, execute via
`@keeperhub/sdk`, write the on-chain receipt, and report back — all locally,
using this agent's own credentials. See [`../../SKILL.md`](../../SKILL.md)
for the full behavioral skill and [`../../README.md`](../../README.md) for
the package overview.

Most read-only commands below are paired with the raw `curl` call they're
equivalent to, so you can bypass the CLI entirely if your agent framework
only shells out to plain HTTP. `submit`/`act` don't have a single-`curl`
equivalent anymore — they're a local pipeline of several HTTP reads, a
KeeperHub SDK call, and an on-chain write, not one call — see each command's
own section below for how to reproduce the individual steps.

## Install

Written in TypeScript and run directly by Node's built-in TypeScript
support (no `tsc` build step, no `ts-node`/`tsx`) — requires **Node ≥22.6**.
Relative imports use explicit `.ts` extensions (`allowImportingTsExtensions`
in `tsconfig.json`) so Node's native loader can resolve them as-is.

```bash
cd agent-skills/scripts/cli
npm install
node bin/procure.ts status
# or, to use `procure` as a bare command:
npm link
```

Edits to `bin/*.ts` or `src/*.ts` take effect immediately — there is nothing
to rebuild. Run `npm run typecheck` to type-check without emitting anything.

## Configuration

```bash
export PROCURE_BASE_URL="http://localhost:3000"      # default shown — the platform's URL
export PROCURE_PRIVATE_KEY="0x..."                   # your EOA key — SIWX auth AND the on-chain receipt write
export PROCURE_MCP_API_KEY="..."                     # only if the platform's /api/agent/mcp requires it
export PROCURE_CHAIN_ID="84532"                      # default shown, bare chain id used to build eip155:<id>
export PROCURE_KEEPERHUB_API_KEY="kh_..."            # your own KeeperHub org key — unset = demo mode
export PROCURE_KEEPERHUB_BASE_URL="https://app.keeperhub.com/api"  # default shown — include /api if you override this
export PROCURE_KEEPERHUB_EXECUTION_MODE="direct"     # default shown
export PROCURE_REGISTRY_ADDRESS="0x..."              # deployed ProcurementRegistry (../../../contracts) — unset = on-chain write skipped
export PROCURE_RPC_URL="https://sepolia.base.org"    # default shown
```

Same keys (`baseUrl`, `privateKey`, `mcpApiKey`, `keeperHubApiKey`,
`keeperHubBaseUrl`, `keeperHubExecutionMode`, `registryAddress`, `rpcUrl`)
can instead be persisted to `~/.procure/config.json` via
`procure config set <key> <value>`; env vars win when both are set. The
`curl` examples below assume:

```bash
BASE_URL="${PROCURE_BASE_URL:-http://localhost:3000}"
```

## Commands and their `curl` equivalents

### `procure status`

Health-checks the agent and prints this CLI's resolved config.

```bash
procure status
```
```bash
curl -s "$BASE_URL/api/health"
```

### `procure card [providerId]`

Fetches this agent's own Agent Card, or a discovered provider's by id.

```bash
procure card
procure card provider-aave-v3
```
```bash
curl -s "$BASE_URL/api/agent/.well-known/agent-card.json"
curl -s "$BASE_URL/api/mock-providers/provider-aave-v3/.well-known/agent-card.json"
```

### `procure discover`

A2A discovery preview — no auth, no purchase.

```bash
procure discover
```
```bash
curl -s -X POST "$BASE_URL/api/agent/entrypoints/discover/invoke" \
  -H "Content-Type: application/json" \
  -d '{"input": {}}'
```

### `procure policy`

Shows the enterprise's current, admin-editable policy — **you** are
responsible for evaluating candidates against it yourself (`src/policy.ts`);
the platform no longer enforces it on your behalf at execution time.

```bash
procure policy
```
```bash
curl -s -X POST "$BASE_URL/api/agent/entrypoints/policy/invoke" \
  -H "Content-Type: application/json" \
  -d '{"input": {}}'
```

### `procure auth` (SIWX — needs a real signature)

```bash
procure auth
```

`curl` alone can only get you the first half of this — the challenge. The
server always 401s an unsigned call:

```bash
curl -i -X POST "$BASE_URL/api/agent/entrypoints/authenticate/invoke" \
  -H "Content-Type: application/json" \
  -d '{"input": {}}'
# -> 401, body.extensions["sign-in-with-x"] carries the challenge (see
#    ../../references/protocols.md for the exact shape)
```

Completing the round trip means EIP-191-signing that challenge with an EOA
and retrying the *same* request with a `SIGN-IN-WITH-X` header carrying
`{ info, address, signature }`:

```bash
curl -s -X POST "$BASE_URL/api/agent/entrypoints/authenticate/invoke" \
  -H "Content-Type: application/json" \
  -H "SIGN-IN-WITH-X: <base64 of { info, address, signature }>" \
  -d '{"input": {}}'
```

There's no `curl`-only way to produce that signature — `procure auth` (and
`src/siwx.ts`'s `wrapFetchWithSIWx`) exist specifically to do the
challenge -> sign -> retry cycle for you with a real `viem` signer.

### `procure submit --instruction <text> --amount <n> [--asset USDC] [--min-apy 4.0] [--protocol <name...>]`

Runs the whole pipeline **locally**, not as one HTTP call — there's no
single `curl` equivalent anymore. What it actually does, step by step (see
`src/orchestrate.ts:runProcurementLocally`):

```bash
procure submit \
  --instruction "Move 1,000,000 USDC to an approved lending protocol, but only if APY > 4%." \
  --amount 1000000 --asset USDC --min-apy 4.0
```

is equivalent to:

```bash
# 1. read discovery + policy (same as `procure discover` / `procure policy` above)
curl -s -X POST "$BASE_URL/api/agent/entrypoints/discover/invoke" -H "Content-Type: application/json" -d '{"input":{}}'
curl -s -X POST "$BASE_URL/api/agent/entrypoints/policy/invoke" -H "Content-Type: application/json" -d '{"input":{}}'

# 2. evaluatePolicy() over every offer, locally (src/policy.ts) — pick the best eligible one

# 3. execute via @keeperhub/sdk's DirectExecutor.checkAndExecute(), locally, with
#    YOUR OWN PROCURE_KEEPERHUB_API_KEY — no curl equivalent, this is a direct SDK call

# 4. write the receipt on-chain: ProcurementRegistry.recordProcurement(...) via viem,
#    signed with YOUR OWN PROCURE_PRIVATE_KEY — no curl equivalent, this is an on-chain tx

# 5. report the result, SIWX-signed (same challenge/retry shape as `procure auth` above)
curl -s -X POST "$BASE_URL/api/agent/entrypoints/report/invoke" \
  -H "Content-Type: application/json" \
  -H "SIGN-IN-WITH-X: <base64 of { info, address, signature }>" \
  -d '{"input": { "taskId": "...", "status": "completed", "request": {...}, "timeline": [...], "execution": {...} }}'
# -> rejected (500, "agent_not_authorized") unless your address is already
#    on ProcurementRegistry's on-chain authorizedAgents allowlist
```

### `procure act [--payload <file|->]`

Same pipeline as `submit` above, but reads a `ProcurementRequest`-shaped
JSON payload from a file or stdin instead of CLI flags — this is the
command a webhook-triggered automation (Hermes prompt tool, OpenClaw
`run_task`) shells out to:

```bash
echo '{"instruction":"Move 1M USDC...","asset":"USDC","amount":"1000000","minApyBps":400}' | procure act --payload -
procure act --payload webhook-payload.json
```

If the payload includes a `taskId` in valid bytes32 form (`0x` + 64 hex
chars — what `./app`'s dispatcher always sends, see
`app/lib/chain/taskId.ts`), `act` adopts it for both the on-chain receipt
and the report, instead of minting a fresh random one. This is what lets
the platform's dashboard find and update the exact task it's already
showing as "dispatched" rather than the result landing under an id it's
never seen. A `taskId` that isn't valid bytes32 (or a missing one, as with
`submit`) falls back to a fresh random id, same as before.

No `curl` equivalent — same reasoning as `submit`.

### `procure task <taskId>`

```bash
procure task 3f9e2b7a-...
```
```bash
curl -s -X POST "$BASE_URL/api/agent/entrypoints/procurement_status/invoke" \
  -H "Content-Type: application/json" \
  -d '{"input": {"taskId": "3f9e2b7a-..."}}'
```

### `procure mcp-call <toolName> [jsonArgs]`

Calls a tool on `/api/agent/mcp` directly. The server is stateless
(no session id), but each call still does the standard MCP `initialize`
handshake before `tools/call`, exactly as `src/api.ts`'s `callMcpTool` does:

```bash
procure mcp-call get_policy '{}'
```
```bash
curl -s -X POST "$BASE_URL/api/agent/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1.0.0"}}}'

curl -s -X POST "$BASE_URL/api/agent/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $PROCURE_MCP_API_KEY" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_policy","arguments":{}}}'
```

Add `-H "Authorization: Bearer $PROCURE_MCP_API_KEY"` to both calls if the
server enforces `AGENT_MCP_API_KEY`. The response may come back
SSE-shaped — look for a `data: {...}` line and `JSON.parse` its payload, the
same way `src/api.ts` does.

### `procure config get` / `procure config set <key> <value>`

No HTTP equivalent — these only read/write `~/.procure/config.json` on
disk (`baseUrl`, `privateKey`, `mcpApiKey`, `keeperHubApiKey`,
`keeperHubBaseUrl`, `keeperHubExecutionMode`, `registryAddress`, `rpcUrl`).

## See also

- [`../../SKILL.md`](../../SKILL.md) — step-by-step behavioral guide, each
  step paired with its natural-language phrasing (for a human prompting
  through a messaging gateway like Telegram) and its `procure` command.
- [`../../references/protocols.md`](../../references/protocols.md) — exact
  SIWX wire format, ERC-8004 gate mechanics, KeeperHub's guarded execution,
  and each webhook platform's exact signature scheme.
- [`../../references/api-reference.md`](../../references/api-reference.md) —
  every HTTP entrypoint, request/response shapes, error modes.
- [`../../references/mcp-tools.md`](../../references/mcp-tools.md) — the
  read-only MCP tool list and the MCP trust-boundary note.
- [`../../../contracts/README.md`](../../../contracts/README.md) —
  `ProcurementRegistry.sol`, what `PROCURE_REGISTRY_ADDRESS` points at.
