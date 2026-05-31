import { ok } from "@/lib/api/responses";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return ok({
    id,
    status: "disconnect_requested",
    cleanup: ["encrypted token", "integration cache", "audit log entry"]
  });
}
