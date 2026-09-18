import { readProcurementHistory, isRegistryConfigured } from "@/lib/chain/registry";
import { getTask, listTasks } from "@/lib/store";
import type { ProcurementTask } from "@/lib/types";

const TERMINAL_STATUSES = new Set(["completed", "rejected", "failed"]);

/**
 * The dashboard's activity/receipt history — merges the on-chain
 * `ProcurementRecorded` log (the durable source of truth, once a connected
 * wallet has created/selected a registry — see
 * `lib/chain/activeRegistryStore.ts`) with whatever rich detail (timeline,
 * policy evaluation) the reporting agent POSTed to `lib/store.ts` for the
 * same `taskId`. Also includes every task not yet in a terminal status
 * (`dispatched`, `authenticating`, `discovering`, `evaluating_policy`,
 * `executing` — see `ProcurementReportSchema`'s status enum), so the
 * dashboard can show *which* step an agent is on instead of a single frozen
 * "dispatched" badge, right up until it resolves.
 *
 * A terminal task (`completed`/`rejected`/`failed`) with no matching
 * on-chain receipt still renders as a finished row, built from the
 * off-chain report alone (`offChainReceipt` below) — this is the normal
 * case whenever the reporting agent has no `PROCURE_REGISTRY_ADDRESS`
 * configured (it logs "skipping on-chain receipt write" and moves on) or
 * this dashboard has no active registry at all. Without this, such a task
 * would vanish from the table entirely: excluded from "pending" because
 * it's terminal, but absent from "receipts" because no on-chain event for
 * it exists. When an on-chain receipt *does* exist, it's preferred over
 * this off-chain shape (it's the durable, authoritative record).
 */
export async function GET() {
  const allTasks = listTasks();
  const pending = allTasks.filter((t) => !TERMINAL_STATUSES.has(t.status));
  const terminalOffChain = allTasks.filter((t) => TERMINAL_STATUSES.has(t.status));

  if (!isRegistryConfigured()) {
    return Response.json({ registryConfigured: false, receipts: terminalOffChain.map(offChainReceipt), dispatched: pending });
  }

  const onChain = await readProcurementHistory();
  const receiptTaskIds = new Set<string>(onChain.map((r) => r.taskId));
  const receipts = onChain.map((receipt) => ({
    ...receipt,
    detail: getTask(receipt.taskId) ?? null,
  }));
  const unrecordedTerminal = terminalOffChain.filter((t) => !receiptTaskIds.has(t.taskId)).map(offChainReceipt);
  const dispatched = pending.filter((t) => !receiptTaskIds.has(t.taskId));

  return Response.json({ registryConfigured: true, receipts: [...receipts, ...unrecordedTerminal], dispatched });
}

/** Shapes a terminal, receipt-less `ProcurementTask` into the same row shape `OnChainReceipt` uses, so the dashboard table doesn't need two render paths. */
function offChainReceipt(task: ProcurementTask) {
  return {
    taskId: task.taskId,
    enterprise: task.enterpriseAddress ?? "",
    agent: task.enterpriseAddress ?? "",
    status: task.status as "completed" | "rejected" | "failed",
    asset: task.request.asset,
    amount: task.request.amount,
    apyBps: task.selectedProvider?.apyBps ?? 0,
    transactionHash: task.execution?.transactionHash ?? task.onChainTransactionHash ?? "",
    detail: task,
  };
}
