import { fail, ok } from "@/lib/api/responses";
import { mockContext } from "@/lib/api/store";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = mockContext();
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
