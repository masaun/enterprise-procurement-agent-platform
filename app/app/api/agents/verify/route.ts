import { verifyAgentOnChain } from "@/lib/identity/gate";
import type { Address } from "viem";

/**
 * Runs the live ERC-8004 gate (`lib/identity/gate.ts`) but never writes
 * on-chain — used by the "Authorized agents" panel (always with a wallet
 * connected; there's no server-signed alternative): it verifies here first,
 * then the connected wallet itself calls `addAuthorizedAgent()`
 * (`lib/chain/registryBrowser.ts`), since a registry's owner is always the
 * wallet that created it via `ProcurementRegistryFactory`.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const address = typeof body.address === "string" ? body.address : undefined;
  const agentId = typeof body.agentId === "string" ? body.agentId : undefined;

  if (!address || !agentId) {
    return Response.json({ error: "invalid_request", message: "address and agentId are required" }, { status: 400 });
  }

  const verification = await verifyAgentOnChain(agentId, address as Address);
  if (!verification.verified) {
    return Response.json({ error: "verification_failed", verification }, { status: 403 });
  }
  return Response.json({ verification });
}
