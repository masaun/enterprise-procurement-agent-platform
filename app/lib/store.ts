import type { ProcurementTask } from "@/lib/types";

/**
 * Rich-detail rendering cache for the dashboard — NOT the source of truth
 * for "did this procurement happen." That's now `ProcurementRegistry` on
 * Base Sepolia (see `lib/chain/registry.ts`), written directly by the
 * external agent's own wallet. This store only holds the fuller
 * `ProcurementTask` detail (full timeline, request, policy evaluation) that
 * the agent POSTs to the `report` entrypoint after recording the on-chain
 * receipt — keyed by the same `taskId` so the two can be joined for display.
 * Still process-local/in-memory (same caveat as before: swap for a durable
 * store before running multiple instances) — losing this cache only loses
 * display detail, not the historical record itself.
 */
const tasks = new Map<string, ProcurementTask>();

export function saveTask(task: ProcurementTask): void {
  tasks.set(task.taskId, task);
}

export function getTask(taskId: string): ProcurementTask | undefined {
  return tasks.get(taskId);
}

export function listTasks(): ProcurementTask[] {
  return Array.from(tasks.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
