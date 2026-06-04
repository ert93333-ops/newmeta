import { resolveUserContext } from "@/lib/api/context";
import { fail, handleError, ok } from "@/lib/api/responses";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const context = await resolveUserContext(request);
    if (id !== context.tenantId) {
      return fail("TENANT_ACCESS_DENIED", "Access denied.", 403);
    }
    return ok({
      tenant: {
        id: context.tenantId,
        name: "Hermes Mock Tenant",
        mode: "internal-first-saas-ready"
      }
    });
  } catch (error) {
    return handleError(error);
  }
}
