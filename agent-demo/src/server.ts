import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AgentDemoConfig, Persona } from "./config.ts";
import { runExternalAgent } from "./agent.ts";

const VALID_PLATFORMS: Persona[] = ["hermes", "openclaw", "generic"];

export interface WebhookServerOptions {
  port: number;
  /** Shared secret this agent "registered" with the enterprise admin — must match the secret typed into ./app's Webhook subscribers form. */
  secret: string;
}

/**
 * The HTTP counterpart to `bin/agent-demo.ts`'s `webhook` command: instead of
 * reading a signed payload from a local file/stdin, this listens for the
 * real dispatch `./app`'s `app/lib/webhooks/dispatch.ts` sends when an admin
 * clicks "Dispatch to subscribed agents" — so `agent-demo` can be registered
 * as a genuine URL in the dashboard's "Webhook subscribers" panel instead of
 * only being driveable via a manual CLI invocation.
 *
 * Route shape mirrors the platform picked when adding the subscriber in the
 * UI: `POST /webhook/hermes`, `/webhook/openclaw`, `/webhook/generic`. Each
 * uses that platform's own signature scheme (see
 * `agent-skills/references/protocols.md`), verified downstream by the LLM's
 * own `verify_webhook_signature` tool call — this server itself does no
 * verification, it just hands off the exact raw bytes and headers it
 * received, the same way `bin/agent-demo.ts webhook` hands off a file's
 * contents.
 *
 * `POST /` (the bare origin, no path) is also accepted, with the platform
 * inferred from whichever signature header is present — an admin pasting
 * just `http://localhost:4021` into the "Webhook subscribers" form (the most
 * natural thing to type, and what the URL looks like before you've read the
 * platform-specific routes below) still works, instead of silently 404ing.
 */
export function startWebhookServer(config: AgentDemoConfig, options: WebhookServerOptions): void {
  const server = createServer((req, res) => {
    handleRequest(req, res, config, options).catch((err) => {
      console.error(`[server] ✗ unhandled error: ${(err as Error).message}`);
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "internal_error" }));
    });
  });

  server.listen(options.port, () => {
    console.log(`[server] agent-demo webhook listener up on http://localhost:${options.port}`);
    console.log(`[server] register one of these as a "Webhook subscribers" URL in ./app, matching the platform you pick there:`);
    for (const platform of VALID_PLATFORMS) {
      console.log(`[server]   ${platform.padEnd(8)} -> http://localhost:${options.port}/webhook/${platform}`);
    }
    console.log(`[server] secret must match too — this server expects: ${options.secret}`);
  });
}

function readRawBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolvePromise(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function flattenHeaders(req: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers[key] = value;
    else if (Array.isArray(value)) headers[key] = value.join(", ");
  }
  return headers;
}

/** Guesses platform from which signature scheme's header shows up (see agent-skills/references/protocols.md). */
function inferPlatform(headers: Record<string, string>, fallback: Persona): Persona {
  if (headers["x-webhook-signature-v2"]) return "hermes";
  if (headers["x-procurement-signature-256"]) return "generic";
  if (headers["authorization"]?.startsWith("Bearer ")) return "openclaw";
  return fallback;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: AgentDemoConfig,
  options: WebhookServerOptions,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method !== "POST" || !(url.pathname === "/" || /^\/webhook\/(hermes|openclaw|generic)\/?$/.test(url.pathname))) {
    console.warn(`[server] ✗ ${req.method} ${url.pathname} — no matching route (expected POST / or POST /webhook/<hermes|openclaw|generic>)`);
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not_found", message: "POST / or POST /webhook/:platform where platform is hermes | openclaw | generic" }));
    return;
  }

  const pathMatch = url.pathname.match(/^\/webhook\/(hermes|openclaw|generic)\/?$/);
  const rawBody = await readRawBody(req);
  const headers = flattenHeaders(req);
  const platform = pathMatch ? (pathMatch[1] as Persona) : inferPlatform(headers, config.persona);
  if (!pathMatch) {
    console.log(`[server] POST / (root) — inferred platform "${platform}" from headers (register .../webhook/${platform} instead to be explicit)`);
  }

  // Ack immediately: ./app's dispatcher only checks that the POST succeeded
  // (see dispatchToSubscriber in app/lib/webhooks/dispatch.ts), and the
  // agent's own reasoning loop (OpenRouter turns + shelling out to
  // `procure`) can run well past a typical webhook timeout.
  res.writeHead(202, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ accepted: true, platform }));

  const log = (line: string) => console.log(line);
  log(`\n[server] received ${platform} webhook POST — handing off to the agent loop`);
  runExternalAgent(config, { kind: "webhook", platform, rawBody, headers, secret: options.secret }, log).catch((err) => {
    console.error(`[server] ✗ agent loop failed: ${(err as Error).message}`);
  });
}
