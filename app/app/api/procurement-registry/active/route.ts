import { isAddress, type Address } from "viem";
import { getActiveRegistryAddress, setActiveRegistryAddress } from "@/lib/chain/activeRegistryStore";

/**
 * The one piece of server-side state this app keeps about `ProcurementRegistry`:
 * which deployment is currently "active" for on-chain reads
 * (`GET /api/procurement-history`) and the inbound agent-facing allowlist
 * gate (`lib/lucid/agent.ts`'s `report` entrypoint). `POST` is called by the
 * dashboard (`ProcurementConsole.tsx`) whenever the connected wallet
 * resolves, creates, or picks a registry via `ProcurementRegistryFactory` —
 * there is no admin-facing way to set this directly, since it should always
 * mirror a registry an actually-connected wallet is using, never a
 * hand-configured address.
 */
export async function GET() {
  return Response.json({ registryAddress: getActiveRegistryAddress() });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const registryAddress = typeof body.registryAddress === "string" ? body.registryAddress : undefined;
  if (!registryAddress || !isAddress(registryAddress)) {
    return Response.json({ error: "invalid_request", message: "registryAddress (a valid EVM address) is required" }, { status: 400 });
  }
  setActiveRegistryAddress(registryAddress as Address);
  return Response.json({ registryAddress });
}
