import { readProcurementHistory, isRegistryConfigured } from "@/lib/chain/registry";
import { getTask } from "@/lib/store";

/**
 * Single-task lookup backing the "Activity & receipts" table's "view"
 * link (`/tasks/[taskId]`) — deliberately an HTTP round trip rather than
 * that page importing `getTask`/`readProcurementHistory` directly. Next.js
 * dev (Turbopack) does not reliably share `lib/store.ts`'s in-memory `Map`
 * between a Route Handler's module graph and a Page's — the same process,
 * but different compiled entrypoints — so a page-level import intermittently
 * saw an empty store for a task this very route could already see. Going
 * through the route sidesteps that entirely.
 */
export async function GET(_request: Request, context: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await context.params;
  const task = getTask(taskId) ?? null;

  let receipt = null;
  if (isRegistryConfigured()) {
    const onChain = await readProcurementHistory();
    receipt = onChain.find((r) => r.taskId.toLowerCase() === taskId.toLowerCase()) ?? null;
  }

  if (!task && !receipt) {
    return Response.json({ error: "not_found", taskId }, { status: 404 });
  }

  return Response.json({ task, receipt });
}
