import { fail, handleError, ok } from "@/lib/api/responses";
import { resolveIdentityContext } from "@/lib/api/context";

export async function GET(request: Request) {
  try {
    const identity = await resolveIdentityContext(request);
    const requestedTenantId = request.headers.get("x-tenant-id") ?? undefined;
    const activeMembership = requestedTenantId
      ? identity.memberships.find((membership) => membership.tenantId === requestedTenantId)
      : identity.memberships[0];

    if (requestedTenantId && !activeMembership) {
      return fail("TENANT_ACCESS_DENIED", "Access denied.", 403);
    }

    return ok({
      user: activeMembership
        ? {
            userId: identity.userId,
            tenantId: activeMembership.tenantId,
            role: activeMembership.role,
            email: identity.email
          }
        : {
            userId: identity.userId,
            email: identity.email
          },
      memberships: identity.memberships,
      activeTenant: activeMembership ?? null,
      permissions: {
        budgetMutation: "hard_blocked",
        dangerousActions: "approval_required"
      }
    });
  } catch (error) {
    return handleError(error);
  }
}
