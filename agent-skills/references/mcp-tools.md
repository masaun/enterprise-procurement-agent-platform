# MCP tools — `POST /app/api/agent/mcp`

Implemented with `@modelcontextprotocol/sdk`'s `McpServer` +
`WebStandardStreamableHTTPServerTransport`, running **stateless**
(`sessionIdGenerator: undefined`): every request gets a fresh server/transport
pair, so there is no session to establish beyond the standard MCP
`initialize` handshake, and no state persists between calls except what's in
`app/lib/store` (procurement tasks).

Connect any MCP client to `{APP_PUBLIC_ORIGIN}/api/agent/mcp`. If
`AGENT_MCP_API_KEY` is set, send `Authorization: Bearer <key>`.

## Trust boundary — read this before using `submit_procurement`

Unlike the HTTP entrypoints (`references/api-reference.md`), MCP tools here
do **not** re-verify a wallet signature per call. An MCP session is assumed
already authorized (API key / OAuth at the transport layer) — the same trust
model KeeperHub's own MCP server (`https://app.keeperhub.com/mcp`) uses for
its connected orgs. `submit_procurement`'s `enterpriseAddress` is therefore
**self-declared by the caller**, not cryptographically verified.

If you need a cryptographically verified wallet signature, call
`POST /api/agent/entrypoints/authenticate/invoke` or `procure/invoke`
directly (see `references/protocols.md`) instead of the MCP tool.

## Tools

| Tool | Input | Description |
| --- | --- | --- |
| `get_agent_card` | `{ providerId?: string }` | This agent's own Agent Card, or a discovered provider's, via `.well-known/agent-card.json`. |
| `discover_providers` | `{}` | A2A discovery preview — no auth, no purchase. |
| `get_policy` | `{}` | Current KeeperHub execution policy. |
| `submit_procurement` | `{ instruction, asset?, amount, minApyBps?, allowedProtocols?, network?, enterpriseAddress }` | Runs the full pipeline and returns a `ProcurementTask`. |
| `get_procurement_status` | `{ taskId: string }` | Look up a previously submitted task. |

Every tool returns MCP's standard `CallToolResult` shape: `content` (a
human-readable text block) plus `structuredContent` (the same data as a
typed JSON object) — use whichever your client prefers.

## Example: `tools/call` for `submit_procurement`

Request:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "submit_procurement",
    "arguments": {
      "instruction": "Move 1,000,000 USDC to an approved lending protocol, but only if APY > 4%.",
      "asset": "USDC",
      "amount": "1000000",
      "minApyBps": 400,
      "enterpriseAddress": "0x269f0c68d3ae7e02ac16ecc2dc5871203759d8ab"
    }
  }
}
```

Response (`result.structuredContent`) is a full `ProcurementTask` — identical
in shape to what `POST /api/agent/entrypoints/procure/invoke` returns (see
`references/api-reference.md`), because both call the same
`app/lib/lucid/orchestrate.ts:runProcurement`.

## From the CLI

```bash
procure mcp-call get_policy '{}'
procure mcp-call submit_procurement '{"instruction":"...","amount":"1000000","enterpriseAddress":"0x..."}'
```
