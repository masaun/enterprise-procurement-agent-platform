import { deleteSubscriber } from "@/lib/webhooks/subscribers";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const deleted = deleteSubscriber(id);
  if (!deleted) return Response.json({ error: "not_found", id }, { status: 404 });
  return Response.json({ id, deleted: true });
}
