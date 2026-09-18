import { isAddress, type Hex } from "viem";
import { isIdentityRegistrationConfigured, registerAgentIdentity } from "@/lib/identity/register";
import { listRegisteredAgents, upsertRegisteredAgent } from "@/lib/identity/registeredAgentsStore";

/**
 * Admin-only platform route (not an agent-facing Lucid entrypoint) backing
 * the dashboard's "Authorize Agent (by Registering in the ERC-8004)" panel.
 * `GET` lists agents this app has registered (see `registeredAgentsStore.ts`
 * — the Identity Registry itself exposes no "list all agents" read). `POST`
 * mints a new ERC-8004 identity, signed by `ENTERPRISE_ADMIN_PRIVATE_KEY` — a
 * step upstream of, and a prerequisite for, `POST /api/agents/authorized`
 * (which assumes an identity already exists). When the admin supplies
 * `agentWalletAddress`, the minted identity is transferred to that address
 * (see `lib/identity/register.ts`) instead of staying with the signer. `PUT`
 * records a registration that was instead signed client-side by a connected
 * wallet (`lib/identity/registerBrowser.ts`), which never touches this route
 * to mint, so the dashboard reports the result back here just for display.
 */
export async function GET() {
  return Response.json({ agents: listRegisteredAgents() });
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => ({}));
  const agentAddressRaw = typeof body.agentAddress === "string" ? body.agentAddress.trim() : undefined;
  const transactionHash = typeof body.transactionHash === "string" ? body.transactionHash.trim() : undefined;

  if (!agentAddressRaw || !isAddress(agentAddressRaw) || !transactionHash) {
    return Response.json(
      { error: "invalid_request", message: "agentAddress (a valid EVM address) and transactionHash are required" },
      { status: 400 },
    );
  }

  const agentId = typeof body.agentId === "string" && body.agentId.trim() ? body.agentId.trim() : undefined;
  const agentURI = typeof body.agentURI === "string" && body.agentURI.trim() ? body.agentURI.trim() : undefined;
  const transferTransactionHash =
    typeof body.transferTransactionHash === "string" && body.transferTransactionHash.trim()
      ? body.transferTransactionHash.trim()
      : undefined;

  const record = {
    agentId,
    agentAddress: agentAddressRaw,
    agentURI,
    transactionHash,
    transferTransactionHash,
    registeredAt: new Date().toISOString(),
  };
  upsertRegisteredAgent(record);
  return Response.json(record, { status: 201 });
}

export async function POST(request: Request) {
  if (!isIdentityRegistrationConfigured()) {
    return Response.json(
      { error: "identity_registration_not_configured", message: "ENTERPRISE_ADMIN_PRIVATE_KEY is not set" },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const agentURI = typeof body.agentURI === "string" && body.agentURI.trim() ? body.agentURI.trim() : undefined;
  const agentWalletAddressRaw =
    typeof body.agentWalletAddress === "string" && body.agentWalletAddress.trim() ? body.agentWalletAddress.trim() : undefined;

  if (agentWalletAddressRaw && !isAddress(agentWalletAddressRaw)) {
    return Response.json({ error: "invalid_request", message: "agentWalletAddress is not a valid EVM address" }, { status: 400 });
  }
  const agentWalletAddress = agentWalletAddressRaw as Hex | undefined;

  try {
    const result = await registerAgentIdentity(agentURI, agentWalletAddress);
    upsertRegisteredAgent({
      agentId: result.agentId,
      agentAddress: result.agentAddress,
      agentURI,
      transactionHash: result.transactionHash,
      transferTransactionHash: result.transferTransactionHash,
      registeredAt: new Date().toISOString(),
    });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: "registration_failed", message: (err as Error).message }, { status: 502 });
  }
}
