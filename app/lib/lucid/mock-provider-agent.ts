import { createAgent } from "@lucid-agents/core";
import { http } from "@lucid-agents/http";
import { identity } from "@lucid-agents/identity";
import { a2a } from "@lucid-agents/a2a";
import { ap2 } from "@lucid-agents/ap2";
import { wallets } from "@lucid-agents/wallet";
import { z } from "zod";
import type { AgentHttpRuntime } from "@lucid-agents/types/http";
import { MOCK_PROVIDERS, liveApyBps, type MockProviderSpec } from "@/lib/lucid/mock-providers";

/**
 * Builds a tiny, real Lucid Agent runtime for one lending-protocol "gateway
 * agent" so the procurement agent has a genuine A2A counterparty to
 * discover and invoke — see the note in `mock-providers.ts`.
 */
function buildMockProviderRuntime(spec: MockProviderSpec) {
  const basePath = `/api/mock-providers/${spec.id}`;

  return createAgent({
    name: spec.name,
    version: "1.0.0",
    description: spec.description,
  })
    .use(wallets({ config: undefined }))
    .use(
      identity({
        config: {
          trust: {
            registrations: [{ agentId: spec.agentId, agentRegistry: spec.agentRegistry }],
            trustModels: spec.trustModels,
          },
        },
      }),
    )
    .use(a2a())
    .use(ap2({ roles: ["merchant"], description: `${spec.protocol} yield supplier` }))
    .use(http({ basePath, servicePage: { preset: "dossier" } }))
    .addEntrypoint({
      key: "quote",
      description: `Current supply APY for ${spec.asset} on ${spec.name}`,
      output: z.object({
        protocol: z.string(),
        asset: z.string(),
        network: z.string(),
        apyBps: z.number(),
        observedAt: z.string(),
      }),
      handler: async () => ({
        output: {
          protocol: spec.protocol,
          asset: spec.asset,
          network: spec.network,
          apyBps: liveApyBps(spec),
          observedAt: new Date().toISOString(),
        },
      }),
    })
    .build();
}

const runtimeCache = new Map<string, ReturnType<typeof buildMockProviderRuntime>>();

export function getMockProviderRuntime(providerId: string): Promise<AgentHttpRuntime> | undefined {
  const spec = MOCK_PROVIDERS.find((p) => p.id === providerId);
  if (!spec) return undefined;

  let runtime = runtimeCache.get(providerId);
  if (!runtime) {
    runtime = buildMockProviderRuntime(spec);
    runtimeCache.set(providerId, runtime);
  }
  return runtime.then((r) => r.http as unknown as AgentHttpRuntime);
}

export function listMockProviderIds(): string[] {
  return MOCK_PROVIDERS.map((p) => p.id);
}
