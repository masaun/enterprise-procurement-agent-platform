import { discoverOffers } from "@/lib/lucid/orchestrate";

/**
 * UI convenience endpoint: the same A2A discovery the procurement agent
 * itself runs (see `/api/agent/entrypoints/discover/invoke`), exposed here
 * so the dashboard can render live provider quotes without going through the
 * full agent-entrypoint invocation contract.
 */
export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const { offers } = await discoverOffers(origin);
  return Response.json({ offers });
}
