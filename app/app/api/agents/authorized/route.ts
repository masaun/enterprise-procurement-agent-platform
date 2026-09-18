import { isAddress, type Address } from "viem";
import { readAuthorizedAgentsOnChain } from "@/lib/chain/registry";
import { getAuthorizedAgent, listAuthorizedAgents } from "@/lib/identity/authorizedAgentsStore";

/**
 * Admin-only platform route (not an agent-facing Lucid entrypoint) backing
 * the dashboard's "Authorized agents" tables (both the live-gate panel and
 * the "Authorize Agent" panel). There is no `POST`/`DELETE` here anymore: a
 * `ProcurementRegistry`'s `Ownable` owner is always the wallet that created
 * it via `ProcurementRegistryFactory` (see `lib/chain/factoryBrowser.ts`),
 * so `addAuthorizedAgent()`/`revokeAuthorizedAgent()` can only be signed by
 * that connected wallet (`lib/chain/registryBrowser.ts`, verified first via
 * `POST /api/agents/verify`) — never a platform-held key. `POST
 * /api/agents/authorized/record` records the display effect of those
 * browser-signed writes into `authorizedAgentsStore`.
 *
 * With `?registryAddress=0x...`, the list is read live from that registry's
 * on-chain `AgentAuthorized`/`AgentRevoked` history and current
 * `authorizedAgents` mapping (see `readAuthorizedAgentsOnChain`) — the
 * authoritative source, unaffected by a server restart wiping the cache or
 * by another wallet's registry ever having shared this process. Cached
 * `authorizedAgentsStore` records (keyed by address) are merged in only for
 * their extra display metadata (`agentId`, verification/reputation). Without
 * a `registryAddress` (e.g. no wallet connected yet), it falls back to the
 * cache alone.
 */
export async function GET(request: Request) {
  const registryAddress = new URL(request.url).searchParams.get("registryAddress");

  if (registryAddress && isAddress(registryAddress)) {
    try {
      const onChain = await readAuthorizedAgentsOnChain(registryAddress as Address);
      const agents = onChain
        .map(({ address, active }) => {
          const cached = getAuthorizedAgent(address);
          return {
            address,
            agentId: cached?.agentId ?? "unknown",
            active,
            addedAt: cached?.addedAt ?? new Date(0).toISOString(),
            verification: cached?.verification ?? { verified: true, agentId: cached?.agentId ?? "unknown" },
          };
        })
        .sort((a, b) => b.addedAt.localeCompare(a.addedAt));
      return Response.json({ agents, source: "chain" });
    } catch (e) {
      return Response.json({ agents: listAuthorizedAgents(), source: "cache", error: (e as Error).message });
    }
  }

  return Response.json({ agents: listAuthorizedAgents(), source: "cache" });
}
