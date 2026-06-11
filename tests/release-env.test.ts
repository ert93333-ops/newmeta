import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkReleaseEnv } from "@/lib/ops/release-env";

function validReleaseEnv(): Record<string, string> {
  return {
    HERMES_APP_URL: "https://app.newmeta.test",
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_value",
    SUPABASE_SECRET_KEY: "sb_secret_test_value",
    SUPABASE_DB_URL: "postgresql://postgres:strong-password@db.project.supabase.co:5432/postgres",
    TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    TOKEN_ENCRYPTION_KEY_ID: "release-20260611",
    HERMES_OAUTH_STATE_SECRET: "oauth-state-secret-with-at-least-32-characters",
    META_APP_ID: "123456789",
    META_APP_SECRET: "meta-secret-value",
    META_REDIRECT_URI: "https://app.newmeta.test/api/integrations/meta/callback",
    HERMES_META_OAUTH_MODE: "live",
    HERMES_APPROVAL_EXECUTION_MODE: "live",
    HERMES_RENDER_PIPELINE_MODE: "live",
    HERMES_PAID_GENERATION_PROVIDER: "generic_http",
    HERMES_PAID_GENERATION_API_URL: "https://provider.newmeta.test/hermes/jobs",
    HERMES_PAID_GENERATION_API_KEY: "paid-provider-secret",
    HERMES_WORKER_SECRET: "worker-secret-with-at-least-32-characters",
    SUPABASE_AUTH_SMOKE_EMAIL: "smoke-test@app.newmeta.test",
    SUPABASE_AUTH_SMOKE_PASSWORD: "smoke-password-with-at-least-16",
    SUPABASE_AUTH_SMOKE_TENANT_ID: "00000000-0000-0000-0000-000000000001"
  };
}

describe("release env gate", () => {
  it("passes with production-safe required env", () => {
    expect(checkReleaseEnv(validReleaseEnv()).passed).toBe(true);
  });

  it("blocks mock auth for release", () => {
    const result = checkReleaseEnv({ ...validReleaseEnv(), HERMES_AUTH_MODE: "mock" });

    expect(result.issues.map((issue) => issue.code)).toContain("MOCK_AUTH_ENABLED");
  });

  it("blocks mock Meta OAuth for release", () => {
    const result = checkReleaseEnv({ ...validReleaseEnv(), HERMES_META_OAUTH_MODE: "mock" });

    expect(result.issues.map((issue) => issue.code)).toContain("META_OAUTH_NOT_LIVE");
  });

  it("requires a live render pipeline mode for release", () => {
    const missing = checkReleaseEnv({ ...validReleaseEnv(), HERMES_RENDER_PIPELINE_MODE: undefined });
    const mock = checkReleaseEnv({ ...validReleaseEnv(), HERMES_RENDER_PIPELINE_MODE: "mock" });

    expect(missing.issues.map((issue) => issue.code)).toContain("MISSING_ENV");
    expect(missing.issues.map((issue) => issue.code)).toContain("RENDER_PIPELINE_NOT_LIVE");
    expect(mock.issues.map((issue) => issue.code)).toContain("PLACEHOLDER_ENV");
    expect(mock.issues.map((issue) => issue.code)).toContain("RENDER_PIPELINE_NOT_LIVE");
  });

  it("allows paid generation to be configured or explicitly disabled for release", () => {
    const missing = checkReleaseEnv({ ...validReleaseEnv(), HERMES_PAID_GENERATION_PROVIDER: undefined });
    const disabled = checkReleaseEnv({ ...validReleaseEnv(), HERMES_PAID_GENERATION_PROVIDER: "disabled" });
    const disabledWithoutProviderSecrets = checkReleaseEnv({
      ...validReleaseEnv(),
      HERMES_PAID_GENERATION_PROVIDER: "disabled",
      HERMES_PAID_GENERATION_API_URL: undefined,
      HERMES_PAID_GENERATION_API_KEY: undefined
    });
    const insecure = checkReleaseEnv({ ...validReleaseEnv(), HERMES_PAID_GENERATION_API_URL: "http://provider.local/jobs" });

    expect(missing.issues.map((issue) => issue.code)).toContain("MISSING_ENV");
    expect(missing.issues.map((issue) => issue.code)).toContain("PAID_GENERATION_PROVIDER_NOT_CONFIGURED");
    expect(disabled.passed).toBe(true);
    expect(disabledWithoutProviderSecrets.passed).toBe(true);
    expect(insecure.issues.map((issue) => issue.code)).toContain("INSECURE_URL");
  });

  it("requires paid provider endpoint and API key when generic_http is enabled", () => {
    const result = checkReleaseEnv({
      ...validReleaseEnv(),
      HERMES_PAID_GENERATION_API_URL: undefined,
      HERMES_PAID_GENERATION_API_KEY: undefined
    });

    expect(result.issues.some((issue) => issue.message.includes("HERMES_PAID_GENERATION_API_URL"))).toBe(true);
    expect(result.issues.some((issue) => issue.message.includes("HERMES_PAID_GENERATION_API_KEY"))).toBe(true);
  });

  it("requires live approval execution mode for release", () => {
    const missing = checkReleaseEnv({ ...validReleaseEnv(), HERMES_APPROVAL_EXECUTION_MODE: undefined });
    const mock = checkReleaseEnv({ ...validReleaseEnv(), HERMES_APPROVAL_EXECUTION_MODE: "mock" });

    expect(missing.issues.map((issue) => issue.code)).toContain("MISSING_ENV");
    expect(missing.issues.map((issue) => issue.code)).toContain("APPROVAL_EXECUTION_NOT_LIVE");
    expect(mock.issues.map((issue) => issue.code)).toContain("PLACEHOLDER_ENV");
    expect(mock.issues.map((issue) => issue.code)).toContain("APPROVAL_EXECUTION_NOT_LIVE");
  });

  it("blocks placeholder and missing env values", () => {
    const result = checkReleaseEnv({
      ...validReleaseEnv(),
      META_APP_ID: "your-meta-app-id",
      META_APP_SECRET: undefined,
      SUPABASE_AUTH_SMOKE_EMAIL: "example@example.com"
    });

    expect(result.issues.map((issue) => issue.code)).toContain("PLACEHOLDER_ENV");
    expect(result.issues.map((issue) => issue.code)).toContain("MISSING_ENV");
  });

  it("blocks release env when app url or auth smoke env is missing", () => {
    const result = checkReleaseEnv({
      ...validReleaseEnv(),
      HERMES_APP_URL: undefined,
      NEXT_PUBLIC_APP_URL: undefined,
      SUPABASE_AUTH_SMOKE_PASSWORD: undefined
    });

    expect(result.issues.map((issue) => issue.code)).toContain("MISSING_ENV");
    expect(result.issues.some((issue) => issue.message.includes("HERMES_APP_URL or NEXT_PUBLIC_APP_URL"))).toBe(true);
    expect(result.issues.some((issue) => issue.message.includes("SUPABASE_AUTH_SMOKE_PASSWORD"))).toBe(true);
  });

  it("blocks localhost app urls", () => {
    const result = checkReleaseEnv({
      ...validReleaseEnv(),
      HERMES_APP_URL: "http://localhost:3000"
    });

    expect(result.issues.map((issue) => issue.code)).toContain("INSECURE_URL");
    expect(result.issues.map((issue) => issue.code)).toContain("LOCALHOST_URL");
  });

  it("blocks invalid token encryption keys", () => {
    const result = checkReleaseEnv({ ...validReleaseEnv(), TOKEN_ENCRYPTION_KEY: "not-base64" });

    expect(result.issues.map((issue) => issue.code)).toContain("INVALID_TOKEN_KEY");
  });

  it("requires an explicit token encryption key id for rotation", () => {
    const missing = checkReleaseEnv({ ...validReleaseEnv(), TOKEN_ENCRYPTION_KEY_ID: undefined });
    const primary = checkReleaseEnv({ ...validReleaseEnv(), TOKEN_ENCRYPTION_KEY_ID: "primary" });

    expect(missing.issues.map((issue) => issue.code)).toContain("MISSING_ENV");
    expect(primary.issues.map((issue) => issue.code)).toContain("DEFAULT_TOKEN_KEY_ID");
  });

  it("blocks weak OAuth state secrets", () => {
    const result = checkReleaseEnv({ ...validReleaseEnv(), HERMES_OAUTH_STATE_SECRET: "short" });

    expect(result.issues.map((issue) => issue.code)).toContain("WEAK_OAUTH_STATE_SECRET");
  });

  it("blocks localhost callback URLs", () => {
    const result = checkReleaseEnv({
      ...validReleaseEnv(),
      META_REDIRECT_URI: "http://localhost:3000/api/integrations/meta/callback"
    });

    expect(result.issues.map((issue) => issue.code)).toContain("INSECURE_URL");
    expect(result.issues.map((issue) => issue.code)).toContain("LOCALHOST_URL");
  });

  it("blocks secret-looking NEXT_PUBLIC env names", () => {
    const result = checkReleaseEnv({
      ...validReleaseEnv(),
      NEXT_PUBLIC_SUPABASE_SECRET_KEY: "sb_secret_should_not_be_public"
    });

    expect(result.issues.map((issue) => issue.code)).toContain("PUBLIC_SECRET_ENV");
  });
});
