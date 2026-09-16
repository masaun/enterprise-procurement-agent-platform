# MCP tools — `POST /app/api/agent/mcp`

Implemented with `@modelcontextprotocol/sdk`'s `McpServer` +
`WebStandardStreamableHTTPServerTransport`, running **stateless**
(`sessionIdGenerator: undefined`): every request gets a fresh server/transport
pair, so there is no session to establish beyond the standard MCP
`initialize` handshake, and no state persists between calls except what's in
`app/lib/store` (procurement task detail — display only, not the source of
truth; see `references/protocols.md`'s ProcurementRegistry section).

Connect any MCP client to `{APP_PUBLIC_ORIGIN}/api/agent/mcp`. If
`AGENT_MCP_API_KEY` is set, send `Authorization: Bearer <key>`.

## Read-only, on purpose

**`submit_procurement` is retired.** MCP tools here do not re-verify a
wallet signature per call — an MCP session is assumed already authorized
(API key / OAuth at the transport layer), which was an appropriate trust
model for read-only discovery/policy lookups but too weak a boundary for
execution now that execution means spending from a real KeeperHub-managed
wallet. Reporting a completed procurement (`report`) requires **both** a
SIWX signature and the platform's live on-chain ERC-8004 allowlist check —
neither of which MCP's transport-level auth provides — so that call only
exists over HTTP (`POST /api/agent/entrypoints/report/invoke`), not MCP.

If your agent framework is MCP-native, use these tools for discovery/policy
reads, then make the `report` HTTP call directly (or shell out to
`procure act`/`submit`, which does the whole local pipeline including the
HTTP `report` call at the end) rather than expecting an MCP tool to do it.

## Tools

| Tool | Input | Description |
| --- | --- | --- |
| `get_agent_card` | `{ providerId?: string }` | This platform's own Agent Card, or a discovered provider's, via `.well-known/agent-card.json`. |
| `discover_providers` | `{}` | A2A discovery preview — platform-hosted market data, no auth, no purchase. |
| `get_policy` | `{}` | The enterprise's current, admin-editable policy. |
| `get_procurement_status` | `{ taskId: string }` | Look up a previously reported task. |

Every tool returns MCP's standard `CallToolResult` shape: `content` (a
human-readable text block) plus `structuredContent` (the same data as a
typed JSON object) — use whichever your client prefers.

## From the CLI

```bash
procure mcp-call get_policy '{}'
procure mcp-call discover_providers '{}'
procure mcp-call get_procurement_status '{"taskId":"0x..."}'
```

For execution, use `procure submit`/`procure act` — not an MCP call.
