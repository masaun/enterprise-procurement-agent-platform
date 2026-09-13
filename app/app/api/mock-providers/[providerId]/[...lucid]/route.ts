import { dispatchLucidRoute } from "@/lib/lucid/http-bind";
import { getMockProviderRuntime } from "@/lib/lucid/mock-provider-agent";

/**
 * Stand-ins for the external lending-protocol "gateway agents" the
 * procurement agent discovers over A2A. See `lib/lucid/mock-providers.ts`
 * for why these exist and `lib/lucid/mock-provider-agent.ts` for how each
 * one is a real (if tiny) `@lucid-agents/core` runtime — this route just
 * exposes that runtime's `.well-known/agent-card.json` and
 * `/entrypoints/quote/invoke` over HTTP, same as `app/api/agent` does for
 * the procurement agent itself.
 */
async function handle(request: Request, context: { params: Promise<{ providerId: string }> }) {
  const { providerId } = await context.params;
  const runtime = await getMockProviderRuntime(providerId);
  if (!runtime) {
    return Response.json({ error: "unknown_provider", providerId }, { status: 404 });
  }
  return dispatchLucidRoute(runtime, request, `/api/mock-providers/${providerId}`);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
