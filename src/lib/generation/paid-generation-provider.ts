export interface PaidGenerationJobInput {
  id: string;
  tenant_id: string;
  job_type: string;
  input_json?: unknown;
}

type EnvRecord = Record<string, string | undefined>;

const GENERIC_HTTP_PROVIDER = "generic_http";
const DEFAULT_TIMEOUT_MS = 120_000;
const SECRET_KEY_PATTERN = /(token|secret|key|authorization|password|credential)/i;

export function isPaidGenerationProviderConfigured(env: EnvRecord = process.env): boolean {
  return (
    env.HERMES_PAID_GENERATION_PROVIDER?.trim() === GENERIC_HTTP_PROVIDER &&
    hasValue(env.HERMES_PAID_GENERATION_API_URL) &&
    hasValue(env.HERMES_PAID_GENERATION_API_KEY)
  );
}

export function assertPaidGenerationProviderConfigured(env: EnvRecord = process.env): void {
  if (!isPaidGenerationProviderConfigured(env)) {
    throw new Error("PAID_GENERATION_WORKER_NOT_CONFIGURED");
  }
  readProviderEndpoint(env);
}

export async function executePaidGenerationJob(
  job: PaidGenerationJobInput,
  workerName: string,
  env: EnvRecord = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<Record<string, unknown>> {
  assertPaidGenerationProviderConfigured(env);
  const endpoint = readProviderEndpoint(env);
  const apiKey = env.HERMES_PAID_GENERATION_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("PAID_GENERATION_WORKER_NOT_CONFIGURED");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), readTimeoutMs(env));
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        jobId: job.id,
        tenantId: job.tenant_id,
        jobType: job.job_type,
        input: job.input_json ?? {}
      }),
      signal: controller.signal
    });

    const providerResult = await readProviderResponse(response);
    if (!response.ok) {
      throw new Error(`PAID_GENERATION_PROVIDER_FAILED:${response.status}`);
    }

    return {
      worker: workerName,
      jobType: job.job_type,
      provider: GENERIC_HTTP_PROVIDER,
      mockSafe: false,
      providerResult,
      actualCredits: readNumberField(providerResult, "actualCredits"),
      actualCostKrw: readNumberField(providerResult, "actualCostKrw")
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("PAID_GENERATION_PROVIDER_TIMEOUT");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function readProviderEndpoint(env: EnvRecord): string {
  const raw = env.HERMES_PAID_GENERATION_API_URL?.trim();
  if (!raw) {
    throw new Error("PAID_GENERATION_WORKER_NOT_CONFIGURED");
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("PAID_GENERATION_PROVIDER_URL_INVALID");
  }

  if (parsed.protocol !== "https:" && isProductionRuntime(env)) {
    throw new Error("PAID_GENERATION_PROVIDER_URL_INSECURE");
  }

  return parsed.toString();
}

function isProductionRuntime(env: EnvRecord): boolean {
  return env.NODE_ENV === "production" || env.VERCEL_ENV === "production";
}

function readTimeoutMs(env: EnvRecord): number {
  const parsed = Number(env.HERMES_PAID_GENERATION_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

async function readProviderResponse(response: Response): Promise<Record<string, unknown>> {
  const contentType = response.headers.get("content-type") ?? "";
  const parsed =
    contentType.includes("application/json") ? ((await response.json()) as unknown) : { text: await response.text() };
  const sanitized = sanitizeProviderPayload(parsed);
  return typeof sanitized === "object" && sanitized !== null && !Array.isArray(sanitized)
    ? (sanitized as Record<string, unknown>)
    : { result: sanitized };
}

function sanitizeProviderPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeProviderPayload(entry));
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !SECRET_KEY_PATTERN.test(key))
      .map(([key, entry]) => [key, sanitizeProviderPayload(entry)])
  );
}

function readNumberField(row: Record<string, unknown>, key: string): number | undefined {
  const value = row[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function hasValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
