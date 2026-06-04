import { fail, ok } from "@/lib/api/responses";
import { resolveUserContext } from "@/lib/api/context";
import { getRepository } from "@/lib/repositories/hermes-repository";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await resolveUserContext(request);
  const job = await getRepository().getJob(request, context, id);
  if (!job) {
    return fail("JOB_NOT_FOUND", "작업을 찾을 수 없습니다.", 404);
  }
  return ok({ job });
}
