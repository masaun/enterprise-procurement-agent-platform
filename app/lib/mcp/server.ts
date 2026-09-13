import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetchAgentCardWithEntrypoints } from "@lucid-agents/a2a";
import { discoverOffers, runProcurement } from "@/lib/lucid/orchestrate";
import { resolveAppOrigin } from "@/lib/lucid/agent";
import { getConfiguredPolicy } from "@/lib/keeperhub/policy";
import { getTask } from "@/lib/store";
import { MOCK_PROVIDERS } from "@/lib/lucid/mock-providers";
import { ProcurementRequestSchema } from "@/lib/types";

/**
 * The MCP surface for external agents that speak MCP rather than raw
 * A2A/HTTP (Claude Desktop, Hermes, OpenClaw, etc — see
 * `agent-skills/references/mcp-tools.md`). Every tool here is a thin
 * wrapper over the exact same `lib/lucid` + `lib/keeperhub` functions the
 * `/api/agent` HTTP entrypoints and the browser UI use, so results are
 * identical across all three surfaces.
 *
 * Trust boundary: unlike the HTTP entrypoints, tools here do not re-verify a
 * SIWX wallet signature per call — an MCP session is expected to already be
 * authorized (bearer token / OAuth at the transport, checked in
 * `app/api/agent/mcp/route.ts`), the same way KeeperHub's own MCP server
 * trusts a connected OAuth session's org. `enterpriseAddress` here is
 * therefore self-declared by the caller. For a cryptographically verified
 * wallet signature, use `POST /api/agent/entrypoints/authenticate/invoke`.
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
    "submit_procurement",
    {
      title: "Submit Procurement",
      description:
        'Run the full pipeline for a request like "Move 1M USDC to an approved lending protocol, but only if APY > 4%": A2A discovery, ERC-8004 identity, AP2 mandate, KeeperHub policy check, and guarded on-chain execution.',
      inputSchema: {
        ...ProcurementRequestSchema.shape,
        enterpriseAddress: z.string().describe("The enterprise treasury wallet address this purchase is made on behalf of."),
      },
    },
    async ({ enterpriseAddress, ...request }) => {
      const task = await runProcurement({ request, enterpriseAddress, origin: resolveAppOrigin() });
      return asResult(task);
    },
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
