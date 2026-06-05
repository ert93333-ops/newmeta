import { resolveIdentityContext } from "@/lib/api/context";
import { fail, handleError, ok } from "@/lib/api/responses";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const identity = await resolveIdentityContext(request);
    const membership = identity.memberships.find((item) => item.tenantId === id);

    if (!membership) {
      return fail("TENANT_ACCESS_DENIED", "Access denied.", 403);
    }

    return ok({
      tenant: {
        id: membership.tenantId,
        name: membership.name,
        role: membership.role,
        isInternal: membership.isInternal,
        crossTenantLearningOptIn: membership.crossTenantLearningOptIn
      }
    });
  } catch (error) {
    return handleError(error);
  }
}
