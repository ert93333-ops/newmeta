import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkReleaseEnv } from "@/lib/ops/release-env";

function validReleaseEnv(): Record<string, string> {
  return {
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_value",
    SUPABASE_SECRET_KEY: "sb_secret_test_value",
    SUPABASE_DB_URL: "postgresql://postgres:strong-password@db.project.supabase.co:5432/postgres",
    TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    META_APP_ID: "123456789",
    META_APP_SECRET: "meta-secret-value",
    META_REDIRECT_URI: "https://app.newmeta.test/api/integrations/meta/callback",
    HERMES_META_OAUTH_MODE: "live",
    HERMES_WORKER_SECRET: "worker-secret-with-at-least-32-characters"
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

  it("blocks placeholder and missing env values", () => {
    const result = checkReleaseEnv({
      ...validReleaseEnv(),
      META_APP_ID: "your-meta-app-id",
      META_APP_SECRET: undefined
    });

    expect(result.issues.map((issue) => issue.code)).toContain("PLACEHOLDER_ENV");
    expect(result.issues.map((issue) => issue.code)).toContain("MISSING_ENV");
  });

  it("blocks invalid token encryption keys", () => {
    const result = checkReleaseEnv({ ...validReleaseEnv(), TOKEN_ENCRYPTION_KEY: "not-base64" });

    expect(result.issues.map((issue) => issue.code)).toContain("INVALID_TOKEN_KEY");
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
