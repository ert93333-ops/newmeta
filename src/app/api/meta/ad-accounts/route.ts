import { MockMetaAdapter } from "@/lib/meta/mock-meta-adapter";
import { ok } from "@/lib/api/responses";

export async function GET() {
  const adapter = new MockMetaAdapter();
  return ok({
    adAccounts: await adapter.listAdAccounts()
  });
}
