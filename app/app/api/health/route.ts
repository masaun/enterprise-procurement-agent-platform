import { isRegistryConfigured } from "@/lib/chain/registry";

/** UI-only convenience endpoint — not part of the agent-facing surface. */
export async function GET() {
  return Response.json({
    ok: true,
    registryConfigured: isRegistryConfigured(),
    agentCard: "/api/agent/.well-known/agent-card.json",
    mcp: "/api/agent/mcp",
    time: new Date().toISOString(),
  });
}
