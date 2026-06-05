import { afterEach, describe, expect, it } from "vitest";
import { isProductionRuntime, mockContext, resolveIdentityContext, resolveUserContext } from "@/lib/api/context";

const ENV_KEYS = [
  "NODE_ENV",
  "VERCEL_ENV",
  "HERMES_AUTH_MODE",
  "HERMES_DEFAULT_TENANT_ID",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
] as const;

const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const mutableEnv = process.env as unknown as Record<string, string | undefined>;

function setEnv(key: (typeof ENV_KEYS)[number], value: string): void {
  mutableEnv[key] = value;
}

function unsetEnv(key: (typeof ENV_KEYS)[number]): void {
  delete mutableEnv[key];
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = ORIGINAL_ENV[key];
    if (value === undefined) {
      unsetEnv(key);
    } else {
      setEnv(key, value);
    }
  }
}

function clearAuthEnv(): void {
  for (const key of ENV_KEYS) {
    unsetEnv(key);
  }
}

describe("API context", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("uses mock context when Supabase env is not configured", async () => {
    clearAuthEnv();

    const context = await resolveUserContext(new Request("http://localhost/api/me"));

    expect(context.role).toBe("owner");
    expect(context.tenantId).toBeTruthy();
  });

  it("allows explicit mock auth outside production", async () => {
    clearAuthEnv();
    setEnv("HERMES_AUTH_MODE", "mock");

    const context = mockContext();

    expect(context.role).toBe("owner");
    expect(isProductionRuntime()).toBe(false);
  });

  it("returns mock tenant memberships for local identity bootstrap", async () => {
    clearAuthEnv();
    setEnv("HERMES_AUTH_MODE", "mock");

    const identity = await resolveIdentityContext(new Request("http://localhost/api/me"));

    expect(identity.memberships).toEqual([
      expect.objectContaining({
        tenantId: expect.any(String),
        role: "owner",
        name: "Hermes Mock Tenant"
      })
    ]);
  });

  it("requires Supabase auth when production env is missing Supabase config", async () => {
    clearAuthEnv();
    setEnv("NODE_ENV", "production");

    await expect(resolveUserContext(new Request("http://localhost/api/me"))).rejects.toThrow("SUPABASE_AUTH_REQUIRED");
  });

  it("blocks explicit mock auth in production", async () => {
    clearAuthEnv();
    setEnv("HERMES_AUTH_MODE", "mock");
    setEnv("VERCEL_ENV", "production");

    await expect(resolveUserContext(new Request("http://localhost/api/me"))).rejects.toThrow(
      "MOCK_AUTH_DISABLED_IN_PRODUCTION"
    );
  });

  it("requires a bearer token when Supabase user config is available", async () => {
    clearAuthEnv();
    setEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    setEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");

    await expect(resolveUserContext(new Request("http://localhost/api/me"))).rejects.toThrow("AUTH_REQUIRED");
  });

  it("requires explicit tenant context in production", async () => {
    clearAuthEnv();
    setEnv("NODE_ENV", "production");
    setEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    setEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");
    setEnv("HERMES_DEFAULT_TENANT_ID", "00000000-0000-0000-0000-000000000001");

    await expect(
      resolveUserContext(
        new Request("http://localhost/api/me", {
          headers: {
            authorization: "Bearer fake-token"
          }
        })
      )
    ).rejects.toThrow("TENANT_REQUIRED");
  });
});
