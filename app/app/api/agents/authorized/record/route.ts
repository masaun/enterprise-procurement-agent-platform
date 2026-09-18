import { markRevoked, upsertAuthorizedAgent } from "@/lib/identity/authorizedAgentsStore";
import type { AgentVerification } from "@/lib/identity/gate";

/**
 * Records the *display* effect of an authorize/revoke that a connected
 * wallet already performed directly on-chain (see
 * `lib/chain/registryBrowser.ts`) — this route never itself writes to a
 * `ProcurementRegistry`; it only updates the same in-memory
 * `authorizedAgentsStore` that `GET /api/agents/authorized` reads for the
 * dashboard's "Authorized agents" list. There is no other, server-signed
 * write path anymore — a registry's owner is always the wallet that created
 * it via `ProcurementRegistryFactory`, so only that connected wallet can
 * ever call `addAuthorizedAgent()`/`revokeAuthorizedAgent()`.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const address = typeof body.address === "string" ? body.address : undefined;
  if (!address) {
    return Response.json({ error: "invalid_request", message: "address is required" }, { status: 400 });
  }

  if (body.active === false) {
    markRevoked(address);
    return Response.json({ address, active: false });
  }

  const agentId = typeof body.agentId === "string" ? body.agentId : undefined;
  const verification = body.verification as AgentVerification | undefined;
  if (!agentId || !verification) {
    return Response.json(
      { error: "invalid_request", message: "agentId and verification are required to record an authorization" },
      { status: 400 },
    );
  }

  const record = { address, agentId, active: true, verification, addedAt: new Date().toISOString() };
  upsertAuthorizedAgent(record);
  return Response.json(record);
}
