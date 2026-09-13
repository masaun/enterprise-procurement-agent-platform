import { getTask } from "@/lib/store";

export async function GET(_request: Request, context: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await context.params;
  const task = getTask(taskId);
  if (!task) return Response.json({ error: "not_found", taskId }, { status: 404 });
  return Response.json(task);
}
