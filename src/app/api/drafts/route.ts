import { handleError, ok } from "@/lib/api/responses";
import { resolveUserContext } from "@/lib/api/context";
import { getRepository } from "@/lib/repositories/hermes-repository";

export async function GET(request: Request) {
  try {
    const context = await resolveUserContext(request);
    const drafts = await getRepository().listAdDrafts(request, context);
    return ok({ drafts });
  } catch (error) {
    return handleError(error);
  }
}
