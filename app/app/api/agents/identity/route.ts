import { isIdentityRegistrationConfigured, registerAgentIdentity } from "@/lib/identity/register";

/**
 * Admin-only platform route (not an agent-facing Lucid entrypoint) backing
 * the dashboard's "Authorize Agent (by Registering in the ERC-8004)" panel.
 * Mints a new ERC-8004 identity for the wallet configured via
 * `AGENT_IDENTITY_PRIVATE_KEY` — a step upstream of, and a prerequisite for,
 * `POST /api/agents/authorized` (which assumes an identity already exists).
 */
export async function POST(request: Request) {
  if (!isIdentityRegistrationConfigured()) {
    return Response.json(
      { error: "identity_registration_not_configured", message: "AGENT_IDENTITY_PRIVATE_KEY is not set" },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const agentURI = typeof body.agentURI === "string" && body.agentURI.trim() ? body.agentURI.trim() : undefined;

  try {
    const result = await registerAgentIdentity(agentURI);
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: "registration_failed", message: (err as Error).message }, { status: 502 });
  }
}
