import { fetchAgentCardWithEntrypoints, invokeAgent } from "@lucid-agents/a2a";
import { MOCK_PROVIDERS } from "@/lib/lucid/mock-providers";
import type { ProcurementTask, ProviderOffer, TimelineEventKind } from "@/lib/types";

/**
 * "Who should I buy from?" — the platform-hosted half of the old pipeline.
 * This still runs server-side: the mock provider agents are market data
 * this platform hosts (not the enterprise's own actor logic), so every
 * caller — the dashboard, and any external agent's `procure discover` /
 * `GET /api/agent/entrypoints/discover/invoke` — reads the same live A2A
 * discovery. What used to follow this (policy evaluation, KeeperHub
 * execution) now runs on the external agent's own machine — see
 * `agent-skills/scripts/cli/src/orchestrate.ts`.
 */
async function discoverProviderOffers(origin: string, task: Pick<ProcurementTask, "timeline">): Promise<ProviderOffer[]> {
  const offers: ProviderOffer[] = [];

  for (const spec of MOCK_PROVIDERS) {
    try {
      const baseUrl = `${origin}/api/mock-providers/${spec.id}`;
      const card = await fetchAgentCardWithEntrypoints(baseUrl);

      pushEvent(task, "identity.resolved", `Resolved ERC-8004 identity for ${card.name} (@lucid-agents/identity)`, {
        agentRegistry: spec.agentRegistry,
        trustModels: card.trustModels ?? spec.trustModels,
      });

      const invoked = await invokeAgent(card, "quote", {});
      const quote = invoked.output as { protocol: string; asset: string; network: string; apyBps: number };

      pushEvent(task, "a2a.invoked", `Invoked "quote" skill on ${card.name} via A2A`, { skill: "quote", output: quote });

      offers.push({
        agentId: spec.agentId,
        name: card.name,
        protocol: quote.protocol,
        asset: quote.asset,
        network: quote.network,
        apyBps: quote.apyBps,
        cardUrl: `${baseUrl}/.well-known/agent-card.json`,
        trustModels: spec.trustModels,
        registration: { agentRegistry: spec.agentRegistry },
        rateContract: spec.rateContract,
        supplyContract: spec.supplyContract,
      });
    } catch (err) {
      pushEvent(task, "a2a.invoked", `Failed to reach ${spec.name}: ${(err as Error).message}`, { providerId: spec.id, error: true });
    }
  }

  return offers;
}

/** Discovery without a purchase — lets an external agent preview candidates before committing. */
export async function discoverOffers(origin: string): Promise<{ offers: ProviderOffer[]; timeline: ProcurementTask["timeline"] }> {
  const ephemeral: Pick<ProcurementTask, "timeline"> = { timeline: [] };
  const offers = await discoverProviderOffers(origin, ephemeral);
  return { offers, timeline: ephemeral.timeline };
}

function pushEvent(task: Pick<ProcurementTask, "timeline">, kind: TimelineEventKind, label: string, detail?: Record<string, unknown>) {
  task.timeline.push({ kind, label, detail, at: new Date().toISOString() });
}
