import { revokeAuthorizedAgentOnChain } from "@/lib/chain/registry";
import { markRevoked } from "@/lib/identity/authorizedAgentsStore";
import type { Address } from "viem";

export async function DELETE(_request: Request, context: { params: Promise<{ address: string }> }) {
  const { address } = await context.params;
  const transactionHash = await revokeAuthorizedAgentOnChain(address as Address);
  markRevoked(address);
  return Response.json({ address, active: false, transactionHash });
}
