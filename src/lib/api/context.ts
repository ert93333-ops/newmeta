import { createSupabaseClient, getBearerAuthorization, hasSupabaseConfig } from "@/lib/supabase/server";
import type { UserContext, UserRole } from "@/lib/types";

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";
const DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000010";

export function mockContext(): UserContext {
  return {
    userId: DEFAULT_USER_ID,
    tenantId: process.env.HERMES_DEFAULT_TENANT_ID ?? DEFAULT_TENANT_ID,
    role: "owner",
    email: "owner@example.com"
  };
}

export async function resolveUserContext(request: Request): Promise<UserContext> {
  if (process.env.HERMES_AUTH_MODE === "mock" || !hasSupabaseConfig("user")) {
    return mockContext();
  }

  const authorization = getBearerAuthorization(request);
  if (!authorization) {
    throw new Error("AUTH_REQUIRED");
  }

  const supabase = createSupabaseClient("user", authorization);
  if (!supabase) {
    return mockContext();
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    throw new Error("AUTH_REQUIRED");
  }

  const requestedTenantId = request.headers.get("x-tenant-id") ?? process.env.HERMES_DEFAULT_TENANT_ID;
  if (!requestedTenantId) {
    throw new Error("TENANT_REQUIRED");
  }

  const { data: role, error: roleError } = await supabase
    .from("user_roles")
    .select("role, tenant_id")
    .eq("tenant_id", requestedTenantId)
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (roleError || !role) {
    throw new Error("TENANT_ACCESS_DENIED");
  }

  return {
    userId: userData.user.id,
    tenantId: role.tenant_id as string,
    role: role.role as UserRole,
    email: userData.user.email
  };
}
