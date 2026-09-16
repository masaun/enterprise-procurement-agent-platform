import { getConfiguredPolicy, updatePolicy } from "@/lib/keeperhub/policy";
import { PolicySchema } from "@/lib/types";

/**
 * Admin-only convenience route backing the dashboard's now-editable policy
 * panel. `POST /api/agent/entrypoints/policy/invoke` (the agent-facing Lucid
 * entrypoint) stays read-only — external agents fetch policy, they don't set
 * it; only a human admin edits it here.
 */
export async function GET() {
  return Response.json(getConfiguredPolicy());
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = PolicySchema.partial().safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_policy", issues: parsed.error.issues }, { status: 400 });
  }
  return Response.json(updatePolicy(parsed.data));
}
