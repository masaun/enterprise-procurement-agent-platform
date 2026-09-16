import { verifyAgentOnChain } from "@/lib/identity/gate";
import { addAuthorizedAgentOnChain, isRegistryConfigured } from "@/lib/chain/registry";
import { listAuthorizedAgents, upsertAuthorizedAgent } from "@/lib/identity/authorizedAgentsStore";
import type { Address } from "viem";

/**
 * Admin-only platform route (not an agent-facing Lucid entrypoint) backing
 * the dashboard's "Authorized agents" panel. `POST` is the live ERC-8004
 * gate: it verifies `agentId` really resolves to `address` on the ERC-8004
 * Identity Registry (see `lib/identity/gate.ts`), and only on success adds
 * `address` to `ProcurementRegistry`'s on-chain allowlist — the contract
 * itself never has to know the ERC-8004 registries' ABI.
 */
export async function GET() {
  return Response.json({ agents: listAuthorizedAgents() });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const address = typeof body.address === "string" ? body.address : undefined;
  const agentId = typeof body.agentId === "string" ? body.agentId : undefined;

  if (!address || !agentId) {
    return Response.json({ error: "invalid_request", message: "address and agentId are required" }, { status: 400 });
  }
  if (!isRegistryConfigured()) {
    return Response.json({ error: "registry_not_configured", message: "PROCUREMENT_REGISTRY_ADDRESS is not set" }, { status: 503 });
  }

  const verification = await verifyAgentOnChain(agentId, address as Address);
  if (!verification.verified) {
    return Response.json({ error: "verification_failed", verification }, { status: 403 });
  }

  const transactionHash = await addAuthorizedAgentOnChain(address as Address);

  const record = {
    address,
    agentId,
    active: true,
    verification,
    addedAt: new Date().toISOString(),
  };
  upsertAuthorizedAgent(record);

  return Response.json({ ...record, transactionHash });
}
