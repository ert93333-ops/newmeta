import { MockMetaAdapter } from "@/lib/meta/mock-meta-adapter";
import { handleError, ok } from "@/lib/api/responses";
import { resolveUserContext } from "@/lib/api/context";

export async function GET(request: Request) {
  try {
    await resolveUserContext(request);
    const adapter = new MockMetaAdapter();
    return ok({
      adAccounts: await adapter.listAdAccounts()
    });
  } catch (error) {
    return handleError(error);
  }
}
