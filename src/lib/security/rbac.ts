import type { UserContext, UserRole } from "@/lib/types";

const ROLE_RANK: Record<UserRole, number> = {
  owner: 5,
  admin: 4,
  marketer: 3,
  analyst: 2,
  viewer: 1
};

export function hasRoleAtLeast(context: UserContext, minimumRole: UserRole): boolean {
  return ROLE_RANK[context.role] >= ROLE_RANK[minimumRole];
}

export function assertTenantAccess(context: UserContext, tenantId: string): void {
  if (context.tenantId !== tenantId) {
    throw new Error("TENANT_ACCESS_DENIED");
  }
}

export function assertRole(context: UserContext, minimumRole: UserRole): void {
  if (!hasRoleAtLeast(context, minimumRole)) {
    throw new Error("ROLE_ACCESS_DENIED");
  }
}
