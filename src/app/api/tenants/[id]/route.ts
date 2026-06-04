import { fail, ok } from "@/lib/api/responses";
import { resolveUserContext } from "@/lib/api/context";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await resolveUserContext(request);
  if (id !== context.tenantId) {
    return fail("TENANT_ACCESS_DENIED", "권한이 없습니다.", 403);
  }
  return ok({
    tenant: {
      id: context.tenantId,
      name: "Hermes Mock Tenant",
      mode: "internal-first-saas-ready"
    }
  });
}
