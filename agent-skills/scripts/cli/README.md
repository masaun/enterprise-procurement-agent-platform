# `procure` — CLI for the Enterprise Procurement Agent

A small dependency-light Node CLI wrapping `./app/api/agent`'s HTTP
entrypoints, for an agent (or human operator) that can shell out to a
command but not easily craft raw HTTP/SIWX calls itself. See
[`../../SKILL.md`](../../SKILL.md) for the full behavioral skill and
[`../../README.md`](../../README.md) for the package overview.

Every command below is paired with the raw `curl` call it is equivalent to,
so you can bypass the CLI entirely if your agent framework only shells out
to plain HTTP. Both hit the exact same underlying logic — see `src/api.js`.

## Install

```bash
cd agent-skills/scripts/cli
npm install
node bin/procure.js status
# or, to use `procure` as a bare command:
npm link
```

## Configuration

```bash
export PROCURE_BASE_URL="http://localhost:3000"   # default shown
export PROCURE_PRIVATE_KEY="0x..."                # your EOA signing key, for real SIWX auth
export PROCURE_MCP_API_KEY="..."                  # only if the server's /api/agent/mcp requires it
export PROCURE_CHAIN_ID="84532"                   # default shown, bare chain id used to build eip155:<id>
```

Same three keys (`baseUrl`, `privateKey`, `mcpApiKey`) can instead be
persisted to `~/.procure/config.json` via `procure config set <key> <value>`;
env vars win when both are set. The `curl` examples below assume:

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

Shows the enterprise's current KeeperHub-enforced policy.

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
`src/siwx.js`'s `wrapFetchWithSIWx`) exist specifically to do the
challenge -> sign -> retry cycle for you with a real `viem` signer.

### `procure submit --instruction <text> --amount <n> [--asset USDC] [--min-apy 4.0] [--protocol <name...>]`

Runs the full procurement pipeline. Same SIWX gating as `auth` above — the
first call 401s, then you retry with a signed `SIGN-IN-WITH-X` header.

```bash
procure submit \
  --instruction "Move 1,000,000 USDC to an approved lending protocol, but only if APY > 4%." \
  --amount 1000000 --asset USDC --min-apy 4.0
```
```bash
curl -s -X POST "$BASE_URL/api/agent/entrypoints/procure/invoke" \
  -H "Content-Type: application/json" \
  -H "SIGN-IN-WITH-X: <base64 of { info, address, signature }>" \
  -d '{
        "input": {
          "instruction": "Move 1,000,000 USDC to an approved lending protocol, but only if APY > 4%.",
          "asset": "USDC",
          "amount": "1000000",
          "minApyBps": 400
        }
      }'
```

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
handshake before `tools/call`, exactly as `src/api.js`'s `callMcpTool` does:

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
same way `src/api.js` does.

### `procure config get` / `procure config set <key> <value>`

No HTTP equivalent — these only read/write `~/.procure/config.json` on
disk (`baseUrl`, `privateKey`, `mcpApiKey`).

## See also

- [`../../SKILL.md`](../../SKILL.md) — step-by-step behavioral guide, each
  step paired with its natural-language phrasing (for a human prompting
  through a messaging gateway like Telegram) and its `procure` command.
- [`../../references/protocols.md`](../../references/protocols.md) — exact
  SIWX wire format (challenge shape, header encoding, CAIP-2 chain ids).
- [`../../references/api-reference.md`](../../references/api-reference.md) —
  every HTTP entrypoint, request/response shapes, error modes.
- [`../../references/mcp-tools.md`](../../references/mcp-tools.md) — the
  full MCP tool list and the MCP trust-boundary note.
