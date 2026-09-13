import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createProcurementMcpServer } from "@/lib/mcp/server";

/**
 * MCP endpoint for external agents (Hermes, OpenClaw, Claude Desktop, ...).
 * Stateless streamable-HTTP: one fresh `McpServer` + transport per request,
 * matching `sessionIdGenerator: undefined` ("stateless mode") in the SDK's
 * own docs — simplest possible thing that's correct across serverless
 * instances, since we don't need cross-request MCP session state (every
 * tool call is independently idempotent against `lib/store`).
 */
async function handle(request: Request): Promise<Response> {
  const apiKey = process.env.AGENT_MCP_API_KEY;
  if (apiKey) {
    const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (provided !== apiKey) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const server = createProcurementMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  return transport.handleRequest(request);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
