import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type SupabaseMode = "user" | "admin";

export function hasSupabaseConfig(mode: SupabaseMode): boolean {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return false;
  }
  if (mode === "admin") {
    return Boolean(process.env.SUPABASE_SECRET_KEY);
  }
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}

export function createSupabaseClient(mode: SupabaseMode, authorization?: string): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = mode === "admin" ? process.env.SUPABASE_SECRET_KEY : process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    return null;
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    },
    global: authorization
      ? {
          headers: {
            Authorization: authorization
          }
        }
      : undefined
  });
}

export function getBearerAuthorization(request: Request): string | undefined {
  const authorization = request.headers.get("authorization") ?? undefined;
  if (!authorization?.startsWith("Bearer ")) {
    return undefined;
  }
  return authorization;
}
