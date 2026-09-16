import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetchAgentCardWithEntrypoints } from "@lucid-agents/a2a";
import { discoverOffers } from "@/lib/lucid/orchestrate";
import { resolveAppOrigin } from "@/lib/lucid/agent";
import { getConfiguredPolicy } from "@/lib/keeperhub/policy";
import { getTask } from "@/lib/store";
import { MOCK_PROVIDERS } from "@/lib/lucid/mock-providers";

/**
 * The MCP surface for external agents that speak MCP rather than raw
 * A2A/HTTP (Claude Desktop, Hermes, OpenClaw, etc — see
 * `agent-skills/references/mcp-tools.md`). Read-only tools only: discovery,
 * policy, and task status. Execution (`submit_procurement`) is retired —
 * that logic now runs on the external agent's own machine, using its own
 * KeeperHub key, and its result is reported via
 * `POST /api/agent/entrypoints/report/invoke` (SIWX + on-chain ERC-8004
 * gated), not through MCP's weaker self-declared-caller trust model.
 *
 * Trust boundary: tools here do not verify a SIWX wallet signature per call
 * — an MCP session is expected to already be authorized (bearer token /
 * OAuth at the transport, checked in `app/api/agent/mcp/route.ts`). That's
 * fine for the read-only tools that remain; it's exactly why execution
 * doesn't live here anymore.
 */
export function createProcurementMcpServer(): McpServer {
  const server = new McpServer({ name: "enterprise-procurement-agent", version: "1.0.0" });

  server.registerTool(
    "get_agent_card",
    {
      title: "Get Agent Card",
      description:
        "Fetch this app's own procurement Agent Card, or a discovered provider's, via A2A/.well-known/agent-card.json.",
      inputSchema: { providerId: z.string().optional() },
    },
    async ({ providerId }) => {
      const origin = resolveAppOrigin();
      const baseUrl = providerId ? `${origin}/api/mock-providers/${providerId}` : `${origin}/api/agent`;
      const card = await fetchAgentCardWithEntrypoints(baseUrl);
      return asResult(card);
    },
  );

  server.registerTool(
    "discover_providers",
    {
      title: "Discover Providers",
      description:
        'Discover candidate lending-protocol service providers over A2A — Lucid\'s "who should I buy from?" step. Read-only, no auth required.',
      inputSchema: {},
    },
    async () => {
      const { offers } = await discoverOffers(resolveAppOrigin());
      return asResult({ offers, count: offers.length, knownProviders: MOCK_PROVIDERS.map((p) => p.id) });
    },
  );

  server.registerTool(
    "get_policy",
    {
      title: "Get Policy",
      description: "The enterprise's current KeeperHub execution policy (max amount, allowed assets/protocols, min APY).",
      inputSchema: {},
    },
    async () => asResult(getConfiguredPolicy()),
  );

  server.registerTool(
    "get_procurement_status",
    {
      title: "Get Procurement Status",
      description: "Look up a previously submitted procurement task by id.",
      inputSchema: { taskId: z.string() },
    },
    async ({ taskId }) => {
      const task = getTask(taskId);
      return asResult(task ?? { found: false, taskId });
    },
  );

  return server;
}

function asResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
  };
}
