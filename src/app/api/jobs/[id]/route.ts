import { resolveUserContext } from "@/lib/api/context";
import { fail, handleError, ok } from "@/lib/api/responses";
import { getRepository } from "@/lib/repositories/hermes-repository";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const context = await resolveUserContext(request);
    const job = await getRepository().getJob(request, context, id);
    if (!job) {
      return fail("JOB_NOT_FOUND", "Job not found.", 404);
    }
    return ok({ job });
  } catch (error) {
    return handleError(error);
  }
}
