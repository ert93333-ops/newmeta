import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { GET as getHealth } from "@/app/api/ops/health/route";
import { buildOpsHealth } from "@/lib/ops/health";

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
    HERMES_WORKER_SECRET: "worker-secret-with-at-least-32-characters",
    SUPABASE_AUTH_SMOKE_EMAIL: "smoke-test@app.newmeta.test",
    SUPABASE_AUTH_SMOKE_PASSWORD: "smoke-password-with-at-least-16",
    SUPABASE_AUTH_SMOKE_TENANT_ID: "00000000-0000-0000-0000-000000000001",
    HERMES_RENDER_PIPELINE_MODE: "live"
  };
}

const ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_DB_URL",
  "TOKEN_ENCRYPTION_KEY",
  "TOKEN_ENCRYPTION_KEY_ID",
  "HERMES_OAUTH_STATE_SECRET",
  "META_APP_ID",
  "META_APP_SECRET",
  "META_REDIRECT_URI",
  "HERMES_META_OAUTH_MODE",
  "HERMES_APPROVAL_EXECUTION_MODE",
  "HERMES_WORKER_SECRET",
  "SUPABASE_AUTH_SMOKE_EMAIL",
  "SUPABASE_AUTH_SMOKE_PASSWORD",
  "SUPABASE_AUTH_SMOKE_TENANT_ID",
  "HERMES_APP_URL",
  "NEXT_PUBLIC_APP_URL",
  "HERMES_RENDER_PIPELINE_MODE"
] as const;
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const mutableEnv = process.env as unknown as Record<string, string | undefined>;

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = ORIGINAL_ENV[key];
    if (value === undefined) {
      delete mutableEnv[key];
    } else {
      mutableEnv[key] = value;
    }
  }
}

function clearReleaseEnv(): void {
  for (const key of ENV_KEYS) {
    delete mutableEnv[key];
  }
}

describe("ops health", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("reports ready when release and operational checks pass", () => {
    const result = buildOpsHealth({ ...validReleaseEnv(), NODE_ENV: "production" });

    expect(result.status).toBe("ready");
    expect(result.checks).toMatchObject({
      supabase: "configured",
      metaOAuth: "live",
      approvalExecution: "live",
      tokenKeyRotation: "configured",
      renderPipeline: "configured",
      workerSecret: "configured"
    });
    expect(JSON.stringify(result)).not.toMatch(/meta-secret-value|smoke-password|sb_secret_test_value/);
  });

  it("blocks production health when the render pipeline is not configured", () => {
    const env = validReleaseEnv();
    delete env.HERMES_RENDER_PIPELINE_MODE;

    const result = buildOpsHealth({ ...env, NODE_ENV: "production" });

    expect(result.status).toBe("blocked");
    expect(result.checks.renderPipeline).toBe("not_configured");
  });

  it("blocks production health when approval execution is not live", () => {
    const env = validReleaseEnv();
    delete env.HERMES_APPROVAL_EXECUTION_MODE;

    const result = buildOpsHealth({ ...env, NODE_ENV: "production" });

    expect(result.status).toBe("blocked");
    expect(result.checks.approvalExecution).toBe("not_live");
  });

  it("blocks health when token key rotation id is missing", () => {
    const env = validReleaseEnv();
    delete env.TOKEN_ENCRYPTION_KEY_ID;

    const result = buildOpsHealth(env);

    expect(result.status).toBe("blocked");
    expect(result.checks.tokenKeyRotation).toBe("missing");
  });

  it("returns 503 while required release env is missing", async () => {
    clearReleaseEnv();

    const response = await getHealth();
    const body = (await response.json()) as { status?: string; release?: { issues?: Array<{ code?: string }> } };

    expect(response.status).toBe(503);
    expect(body.status).toBe("blocked");
    expect(body.release?.issues?.some((issue) => issue.code === "MISSING_ENV")).toBe(true);
  });
});
