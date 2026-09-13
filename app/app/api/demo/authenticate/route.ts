import { getEnterpriseSiwxFetch } from "@/lib/demo/enterprise-signer";
import { resolveAppOrigin } from "@/lib/lucid/agent";

/**
 * UI convenience wrapper: performs a genuine SIWX challenge/sign/retry cycle
 * (via `wrapFetchWithSIWx`) against this app's own
 * `POST /api/agent/entrypoints/authenticate/invoke` — the same endpoint any
 * external agent would call. See `lib/demo/enterprise-signer.ts` for what's
 * simulated here (the wallet) versus what's real (the SIWX protocol).
 */
export async function POST() {
  const siwxFetch = getEnterpriseSiwxFetch();
  const origin = resolveAppOrigin();

  const response = await siwxFetch(`${origin}/api/agent/entrypoints/authenticate/invoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: {} }),
  });

  const body = await response.json().catch(() => undefined);
  if (!response.ok) {
    return Response.json({ error: "authentication_failed", status: response.status, body }, { status: response.status });
  }
  return Response.json(body);
}
