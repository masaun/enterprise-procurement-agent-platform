import { isAddress, type Hex } from "viem";
import { isIdentityRegistrationConfigured, registerAgentIdentity } from "@/lib/identity/register";

/**
 * Admin-only platform route (not an agent-facing Lucid entrypoint) backing
 * the dashboard's "Authorize Agent (by Registering in the ERC-8004)" panel.
 * Mints a new ERC-8004 identity, signed by `ENTERPRISE_ADMIN_PRIVATE_KEY` — a
 * step upstream of, and a prerequisite for, `POST /api/agents/authorized`
 * (which assumes an identity already exists). When the admin supplies
 * `agentWalletAddress`, the minted identity is transferred to that address
 * (see `lib/identity/register.ts`) instead of staying with the signer.
 */
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
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: "registration_failed", message: (err as Error).message }, { status: 502 });
  }
}
