import { ProcurementRequestSchema, type TimelineEvent } from "@/lib/types";
import { getConfiguredPolicy } from "@/lib/keeperhub/policy";
import { dispatchProcurementIntent } from "@/lib/webhooks/dispatch";
import { listTasks, saveTask } from "@/lib/store";
import { randomTaskId } from "@/lib/chain/taskId";

/**
 * The human admin's "describe a procurement intent" action — replaces the
 * old `/api/demo/procure`, which used to execute the whole pipeline itself.
 * Now this only records a pending intent and pushes it out as a webhook to
 * every subscribed external agent (Hermes/OpenClaw/generic); the agent
 * decides whether and how to act, executes via its own KeeperHub key, and
 * reports the outcome back via `POST /api/agent/entrypoints/report/invoke`.
 */
export async function GET() {
  return Response.json({ tasks: listTasks() });
}

export async function POST(request: Request) {
  const json = await request.json().catch(() => ({}));
  const parsed = ProcurementRequestSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  }

  // A bytes32 hex id, not a UUID — the same identifier space
  // `ProcurementRegistry.recordProcurement()` expects on-chain, so an
  // agent's `procure act` can adopt this exact taskId (see
  // agent-skills/scripts/cli/src/orchestrate.ts) instead of minting its own,
  // uncorrelated one. See lib/chain/taskId.ts.
  const taskId = randomTaskId();
  const enterpriseId = process.env.ENTERPRISE_ID || "default-enterprise";
  const policy = getConfiguredPolicy();
  const now = new Date().toISOString();

  const task = {
    taskId,
    status: "dispatched" as const,
    request: parsed.data,
    timeline: [
      {
        kind: "webhook.dispatched",
        label: "Procurement intent recorded, dispatching to subscribed external agents",
        at: now,
      },
    ] as TimelineEvent[],
    createdAt: now,
    updatedAt: now,
  };
  saveTask(task);

  const results = await dispatchProcurementIntent({ taskId, request: parsed.data, policy, enterpriseId });
  task.timeline.push({
    kind: "webhook.dispatched",
    label: `Dispatched to ${results.length} subscriber(s): ${results.filter((r) => r.ok).length} ok, ${results.filter((r) => !r.ok).length} failed`,
    detail: { results },
    at: new Date().toISOString(),
  });
  task.updatedAt = new Date().toISOString();
  saveTask(task);

  return Response.json({ task, dispatch: results }, { status: 201 });
}
