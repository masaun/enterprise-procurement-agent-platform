import { readProcurementHistory, isRegistryConfigured } from "@/lib/chain/registry";
import { getTask, listTasks } from "@/lib/store";

/**
 * The dashboard's activity/receipt history — merges the on-chain
 * `ProcurementRecorded` log (the durable source of truth, once
 * `PROCUREMENT_REGISTRY_ADDRESS` is set) with whatever rich detail
 * (timeline, policy evaluation) the reporting agent POSTed to `lib/store.ts`
 * for the same `taskId`. Also includes still-`dispatched` intents that
 * haven't come back with an on-chain receipt yet.
 */
export async function GET() {
  const dispatchedOnly = listTasks().filter((t) => t.status === "dispatched");

  if (!isRegistryConfigured()) {
    return Response.json({ registryConfigured: false, receipts: [], dispatched: dispatchedOnly });
  }

  const onChain = await readProcurementHistory();
  const receipts = onChain.map((receipt) => ({
    ...receipt,
    detail: getTask(receipt.taskId) ?? null,
  }));

  return Response.json({ registryConfigured: true, receipts, dispatched: dispatchedOnly });
}
