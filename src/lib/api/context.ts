import { createSupabaseClient, getBearerAuthorization, hasSupabaseConfig } from "@/lib/supabase/server";
import type { UserContext, UserRole } from "@/lib/types";

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";
const DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000010";

export interface TenantMembership {
  tenantId: string;
  name: string;
  role: UserRole;
  isInternal: boolean;
  crossTenantLearningOptIn: boolean;
}

export interface IdentityContext {
  userId: string;
  email?: string;
  memberships: TenantMembership[];
}

interface TenantJoinRow {
  id?: string;
  name?: string;
  is_internal?: boolean;
  cross_tenant_learning_opt_in?: boolean;
}

interface UserRoleRow {
  tenant_id: string;
  role: UserRole;
  tenants?: TenantJoinRow | TenantJoinRow[] | null;
}

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

function assertMockAuthAllowed(): void {
  if (isProductionRuntime()) {
    throw new Error("MOCK_AUTH_DISABLED_IN_PRODUCTION");
  }
}

export function mockContext(): UserContext {
  assertMockAuthAllowed();
  return {
    userId: DEFAULT_USER_ID,
    tenantId: process.env.HERMES_DEFAULT_TENANT_ID ?? DEFAULT_TENANT_ID,
    role: "owner",
    email: "owner@example.com"
  };
}

export async function resolveIdentityContext(request: Request): Promise<IdentityContext> {
  if (process.env.HERMES_AUTH_MODE === "mock") {
    return mockIdentityContext();
  }

  if (!hasSupabaseConfig("user")) {
    if (isProductionRuntime()) {
      throw new Error("SUPABASE_AUTH_REQUIRED");
    }
    return mockIdentityContext();
  }

  const authorization = getBearerAuthorization(request);
  if (!authorization) {
    throw new Error("AUTH_REQUIRED");
  }

  const supabase = createSupabaseClient("user", authorization);
  if (!supabase) {
    throw new Error("SUPABASE_AUTH_REQUIRED");
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    throw new Error("AUTH_REQUIRED");
  }

  const { data: rows, error: roleError } = await supabase
    .from("user_roles")
    .select("tenant_id, role, tenants(id, name, is_internal, cross_tenant_learning_opt_in)")
    .eq("user_id", userData.user.id)
    .order("created_at", { ascending: true });

  if (roleError) {
    throw new Error("TENANT_MEMBERSHIPS_UNAVAILABLE");
  }

  return {
    userId: userData.user.id,
    email: userData.user.email,
    memberships: (rows ?? []).map(toTenantMembership)
  };
}

export async function resolveUserContext(request: Request): Promise<UserContext> {
  if (process.env.HERMES_AUTH_MODE === "mock") {
    return mockContext();
  }

  if (!hasSupabaseConfig("user")) {
    if (isProductionRuntime()) {
      throw new Error("SUPABASE_AUTH_REQUIRED");
    }
    return mockContext();
  }

  const authorization = getBearerAuthorization(request);
  if (!authorization) {
    throw new Error("AUTH_REQUIRED");
  }

  const requestedTenantId =
    request.headers.get("x-tenant-id") ?? (isProductionRuntime() ? undefined : process.env.HERMES_DEFAULT_TENANT_ID);
  if (!requestedTenantId) {
    throw new Error("TENANT_REQUIRED");
  }

  const identity = await resolveIdentityContext(request);
  const membership = identity.memberships.find((item) => item.tenantId === requestedTenantId);
  if (!membership) {
    throw new Error("TENANT_ACCESS_DENIED");
  }

  return {
    userId: identity.userId,
    tenantId: membership.tenantId,
    role: membership.role,
    email: identity.email
  };
}

function mockIdentityContext(): IdentityContext {
  const context = mockContext();
  return {
    userId: context.userId,
    email: context.email,
    memberships: [
      {
        tenantId: context.tenantId,
        name: "Hermes Mock Tenant",
        role: context.role,
        isInternal: true,
        crossTenantLearningOptIn: false
      }
    ]
  };
}

function toTenantMembership(row: UserRoleRow): TenantMembership {
  const tenant = normalizeTenantJoin(row.tenants);
  return {
    tenantId: row.tenant_id,
    name: tenant?.name ?? "Unnamed Tenant",
    role: row.role,
    isInternal: tenant?.is_internal ?? false,
    crossTenantLearningOptIn: tenant?.cross_tenant_learning_opt_in ?? false
  };
}

function normalizeTenantJoin(value: UserRoleRow["tenants"]): TenantJoinRow | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value ?? undefined;
}
