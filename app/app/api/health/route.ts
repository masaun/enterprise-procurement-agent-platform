import { isKeeperHubDemoMode } from "@/lib/keeperhub/client";

/** UI-only convenience endpoint — not part of the agent-facing surface. */
export async function GET() {
  return Response.json({
    ok: true,
    demoMode: isKeeperHubDemoMode(),
    agentCard: "/api/agent/.well-known/agent-card.json",
    mcp: "/api/agent/mcp",
    time: new Date().toISOString(),
  });
}
