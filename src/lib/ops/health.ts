import { checkReleaseEnv, type ReleaseEnvIssue } from "@/lib/ops/release-env";

export interface OpsHealthResult {
  status: "ready" | "blocked";
  runtime: {
    nodeEnv?: string;
    vercelEnv?: string;
    production: boolean;
  };
  release: {
    passed: boolean;
    issues: ReleaseEnvIssue[];
  };
  checks: {
    supabase: "configured" | "missing";
    metaOAuth: "live" | "not_live";
    approvalExecution: "live" | "not_live";
    tokenKeyRotation: "configured" | "missing";
    renderPipeline: "configured" | "not_configured";
    paidGenerationProvider: "configured" | "disabled" | "missing";
    authSecurity: "pro" | "free_compensating_controls" | "missing";
    publicSignup: "disabled" | "invite_only" | "not_restricted";
    workerSecret: "configured" | "missing";
  };
}

type EnvRecord = Record<string, string | undefined>;

export function buildOpsHealth(env: EnvRecord): OpsHealthResult {
  const release = checkReleaseEnv(env);
  const production = env.NODE_ENV === "production" || env.VERCEL_ENV === "production";
  const checks = {
    supabase:
      hasValue(env.NEXT_PUBLIC_SUPABASE_URL) && hasValue(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) && hasValue(env.SUPABASE_SECRET_KEY)
        ? "configured"
        : "missing",
    metaOAuth: env.HERMES_META_OAUTH_MODE === "live" ? "live" : "not_live",
    approvalExecution: env.HERMES_APPROVAL_EXECUTION_MODE === "live" ? "live" : "not_live",
    tokenKeyRotation: hasValue(env.TOKEN_ENCRYPTION_KEY_ID) && env.TOKEN_ENCRYPTION_KEY_ID !== "primary" ? "configured" : "missing",
    renderPipeline: env.HERMES_RENDER_PIPELINE_MODE === "live" ? "configured" : "not_configured",
    paidGenerationProvider:
      (env.HERMES_PAID_GENERATION_PROVIDER === "generic_http" &&
        hasValue(env.HERMES_PAID_GENERATION_API_URL) &&
        hasValue(env.HERMES_PAID_GENERATION_API_KEY)) ||
      (env.HERMES_PAID_GENERATION_PROVIDER === "openai" && hasValue(env.OPENAI_API_KEY))
        ? "configured"
        : env.HERMES_PAID_GENERATION_PROVIDER === "disabled"
          ? "disabled"
        : "missing",
    authSecurity:
      env.HERMES_SUPABASE_AUTH_SECURITY_MODE === "pro_leaked_password_protection"
        ? "pro"
        : env.HERMES_SUPABASE_AUTH_SECURITY_MODE === "free_compensating_controls"
          ? "free_compensating_controls"
          : "missing",
    publicSignup:
      env.HERMES_PUBLIC_SIGNUP_MODE === "disabled" || env.HERMES_PUBLIC_SIGNUP_MODE === "invite_only"
        ? env.HERMES_PUBLIC_SIGNUP_MODE
        : "not_restricted",
    workerSecret: hasValue(env.HERMES_WORKER_SECRET) ? "configured" : "missing"
  } as const;
  const operationallyReady =
    release.passed &&
    checks.supabase === "configured" &&
    checks.metaOAuth === "live" &&
    checks.approvalExecution === "live" &&
    checks.tokenKeyRotation === "configured" &&
    (checks.paidGenerationProvider === "configured" || checks.paidGenerationProvider === "disabled") &&
    (checks.authSecurity === "pro" || checks.authSecurity === "free_compensating_controls") &&
    (checks.publicSignup === "disabled" || checks.publicSignup === "invite_only") &&
    checks.workerSecret === "configured" &&
    (!production || checks.renderPipeline === "configured");

  return {
    status: operationallyReady ? "ready" : "blocked",
    runtime: {
      nodeEnv: env.NODE_ENV,
      vercelEnv: env.VERCEL_ENV,
      production
    },
    release,
    checks
  };
}

function hasValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
