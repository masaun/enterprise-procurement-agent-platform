import type { AgentHttpRuntime } from "@lucid-agents/types/http";

/**
 * Binds a Lucid `AgentHttpRuntime`'s route plan (`runtime.http.routes`) to
 * Next.js App Router route handlers. This is the same contract the official
 * Hono/Express adapters use — `route.handle(request, params)` takes and
 * returns Web-standard `Request`/`Response` objects — Next.js route handlers
 * just happen to already speak that language natively, so no adapter package
 * is needed here at all.
 *
 * `mountPath` is the Next.js filesystem segment the catch-all route lives at
 * (e.g. `/api/agent`), used to re-derive the full pathname `runtime.routes`
 * expects, since Next.js hands the catch-all handler only the *remaining*
 * path segments.
 */
export function bindLucidRoutes(runtimePromise: Promise<AgentHttpRuntime>, mountPath: string) {
  async function handle(request: Request): Promise<Response> {
    const runtime = await runtimePromise;
    return dispatchLucidRoute(runtime, request, mountPath);
  }

  return { GET: handle, POST: handle, DELETE: handle };
}

/** Lower-level dispatch used when the runtime must be resolved per-request (e.g. keyed by a dynamic segment). */
export async function dispatchLucidRoute(
  runtime: AgentHttpRuntime,
  request: Request,
  mountPath: string,
): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  for (const route of runtime.routes) {
    if (route.method !== request.method) continue;
    const params = matchPath(route.path, pathname);
    if (params) {
      return route.handle(request, params);
    }
  }

  return Response.json(
    {
      error: "not_found",
      message: `No Lucid route matches ${request.method} ${pathname}`,
      mountPath,
    },
    { status: 404 },
  );
}

/** Matches a route pattern like `/api/agent/entrypoints/:key/invoke` against a real pathname. */
function matchPath(pattern: string, pathname: string): Record<string, string> | undefined {
  const patternSegments = pattern.split("/").filter(Boolean);
  const pathSegments = pathname.split("/").filter(Boolean);
  if (patternSegments.length !== pathSegments.length) return undefined;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternSegments.length; i++) {
    const p = patternSegments[i]!;
    const s = pathSegments[i]!;
    if (p.startsWith(":")) {
      params[p.slice(1)] = decodeURIComponent(s);
    } else if (p !== s) {
      return undefined;
    }
  }
  return params;
}
