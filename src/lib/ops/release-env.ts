export interface ReleaseEnvIssue {
  code: string;
  message: string;
}

export interface ReleaseEnvCheckResult {
  passed: boolean;
  issues: ReleaseEnvIssue[];
}

type EnvRecord = Record<string, string | undefined>;

const REQUIRED_RELEASE_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_DB_URL",
  "TOKEN_ENCRYPTION_KEY",
  "META_APP_ID",
  "META_APP_SECRET",
  "META_REDIRECT_URI",
  "HERMES_WORKER_SECRET"
] as const;

const PLACEHOLDER_PATTERNS = [
  /^your-/i,
  /^replace-with/i,
  /example/i,
  /project-ref/i,
  /:password@/i,
  /base64-encoded/i,
  /mock/i
];

const PUBLIC_SECRET_NAME_PATTERN = /(SECRET|SERVICE|TOKEN|PRIVATE|PASSWORD|DB_URL|META_APP_SECRET|WORKER_SECRET)/i;

function value(env: EnvRecord, key: string): string | undefined {
  const raw = env[key]?.trim();
  return raw || undefined;
}

function isPlaceholder(raw: string): boolean {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(raw));
}

function addIssue(issues: ReleaseEnvIssue[], code: string, message: string): void {
  issues.push({ code, message });
}

function requireUrl(issues: ReleaseEnvIssue[], env: EnvRecord, key: string, options: { allowLocalhost: boolean }): void {
  const raw = value(env, key);
  if (!raw) return;

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") {
      addIssue(issues, "INSECURE_URL", `${key} must use https for release.`);
    }
    if (!options.allowLocalhost && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
      addIssue(issues, "LOCALHOST_URL", `${key} must not point to localhost for release.`);
    }
  } catch {
    addIssue(issues, "INVALID_URL", `${key} must be an absolute URL.`);
  }
}

function requirePostgresUrl(issues: ReleaseEnvIssue[], env: EnvRecord, key: string): void {
  const raw = value(env, key);
  if (!raw) return;

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
      addIssue(issues, "INVALID_DB_URL", `${key} must use a postgres connection URL.`);
    }
  } catch {
    addIssue(issues, "INVALID_DB_URL", `${key} must be an absolute postgres connection URL.`);
  }
}

function requireBase64Key(issues: ReleaseEnvIssue[], env: EnvRecord, key: string): void {
  const raw = value(env, key);
  if (!raw) return;

  try {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length !== 32 || decoded.toString("base64").replace(/=+$/u, "") !== raw.replace(/=+$/u, "")) {
      addIssue(issues, "INVALID_TOKEN_KEY", `${key} must be a base64 encoded 32-byte key.`);
    }
  } catch {
    addIssue(issues, "INVALID_TOKEN_KEY", `${key} must be a base64 encoded 32-byte key.`);
  }
}

export function checkReleaseEnv(env: EnvRecord): ReleaseEnvCheckResult {
  const issues: ReleaseEnvIssue[] = [];

  for (const key of REQUIRED_RELEASE_ENV) {
    const raw = value(env, key);
    if (!raw) {
      addIssue(issues, "MISSING_ENV", `${key} is required for release.`);
      continue;
    }
    if (isPlaceholder(raw)) {
      addIssue(issues, "PLACEHOLDER_ENV", `${key} still contains a placeholder value.`);
    }
  }

  if (value(env, "HERMES_AUTH_MODE") === "mock") {
    addIssue(issues, "MOCK_AUTH_ENABLED", "HERMES_AUTH_MODE=mock must not be set for release.");
  }

  for (const key of Object.keys(env)) {
    if (key.startsWith("NEXT_PUBLIC_") && PUBLIC_SECRET_NAME_PATTERN.test(key)) {
      addIssue(issues, "PUBLIC_SECRET_ENV", `${key} looks secret-bearing and must not be public.`);
    }
  }

  requireUrl(issues, env, "NEXT_PUBLIC_SUPABASE_URL", { allowLocalhost: false });
  requireUrl(issues, env, "META_REDIRECT_URI", { allowLocalhost: false });
  requirePostgresUrl(issues, env, "SUPABASE_DB_URL");
  requireBase64Key(issues, env, "TOKEN_ENCRYPTION_KEY");

  const workerSecret = value(env, "HERMES_WORKER_SECRET");
  if (workerSecret && workerSecret.length < 32) {
    addIssue(issues, "WEAK_WORKER_SECRET", "HERMES_WORKER_SECRET must be at least 32 characters.");
  }

  return {
    passed: issues.length === 0,
    issues
  };
}
