import { handleError, ok } from "@/lib/api/responses";
import { resolveUserContext } from "@/lib/api/context";
import { resolveMetaAdapter } from "@/lib/meta/resolve-meta-adapter";
import { getRepository } from "@/lib/repositories/hermes-repository";

export async function GET(request: Request) {
  try {
    const context = await resolveUserContext(request);
    const resolved = await resolveMetaAdapter({
      request,
      context,
      repository: getRepository()
    });

    return ok({
      adAccounts: await resolved.adapter.listAdAccounts(),
      adapterMode: resolved.mode
    });
  } catch (error) {
    return handleError(error);
  }
}
