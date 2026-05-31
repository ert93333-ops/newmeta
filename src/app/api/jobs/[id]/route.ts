import { fail, ok } from "@/lib/api/responses";
import { getStore } from "@/lib/api/store";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getStore().jobs.get(id);
  if (!job) {
    return fail("JOB_NOT_FOUND", "작업을 찾을 수 없습니다.", 404);
  }
  return ok({ job });
}
