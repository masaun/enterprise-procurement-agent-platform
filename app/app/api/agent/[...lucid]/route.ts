import { bindLucidRoutes } from "@/lib/lucid/http-bind";
import { getProcurementAgentRuntime } from "@/lib/lucid/agent";

/**
 * The external-agent-facing surface (SIWX, A2A Agent Card + tasks, ERC-8004,
 * AP2). This file mounts the real `@lucid-agents/*` route plan verbatim —
 * see `lib/lucid/http-bind.ts` for why no framework adapter is needed.
 *
 * Notable paths under this mount:
 *   GET  /api/agent/.well-known/agent-card.json
 *   GET  /api/agent/.well-known/oasf-record.json
 *   GET  /api/agent/health
 *   GET  /api/agent/entrypoints
 *   POST /api/agent/entrypoints/:key/invoke
 *   POST /api/agent/tasks
 *   GET  /api/agent/tasks/:taskId
 */
const { GET, POST, DELETE } = bindLucidRoutes(
  getProcurementAgentRuntime().then((runtime) => runtime.http),
  "/api/agent",
);

export { GET, POST, DELETE };
