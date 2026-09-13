import type { ProcurementTask } from "@/lib/types";

/**
 * Process-local task store. Good enough for a single-instance demo; swap for
 * a durable store (KV/Postgres) before running multiple instances, same
 * caveat Lucid's own `TaskStore` docs call out for its A2A task runtime.
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
