import { getEnterpriseSiwxFetch } from "@/lib/demo/enterprise-signer";
import { resolveAppOrigin } from "@/lib/lucid/agent";
import { ProcurementRequestSchema } from "@/lib/types";

/**
 * UI convenience wrapper around `POST /api/agent/entrypoints/procure/invoke`
 * — same SIWX-authenticated call an external agent would make, just issued
 * on the enterprise's behalf by the demo signer instead of a browser wallet.
 */
export async function POST(request: Request) {
  const json = await request.json().catch(() => ({}));
  const parsed = ProcurementRequestSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  }

  const siwxFetch = getEnterpriseSiwxFetch();
  const origin = resolveAppOrigin();

  const response = await siwxFetch(`${origin}/api/agent/entrypoints/procure/invoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: parsed.data }),
  });

  const body = await response.json().catch(() => undefined);
  if (!response.ok) {
    return Response.json({ error: "procurement_failed", status: response.status, body }, { status: response.status });
  }
  return Response.json(body);
}
