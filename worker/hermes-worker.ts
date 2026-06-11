import { Client } from "pg";
import {
  executePaidGenerationJob,
  isPaidGenerationProviderConfigured
} from "@/lib/generation/paid-generation-provider";

export interface ClaimedCreativeJob {
  id: string;
  tenant_id: string;
  created_by?: string | null;
  job_type: string;
  input_json?: unknown;
  attempts?: number;
  max_attempts?: number;
}

interface WorkerDbClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface WorkerRunResult {
  claimed: boolean;
  jobId?: string;
  status?: "succeeded" | "queued" | "failed";
}

interface PaidGenerationCostInput {
  provider: string;
  model?: string;
  operationType: string;
  estimatedCredits: number;
  estimatedCostKrw: number;
  relatedJobId: string;
  actualCredits?: number;
  actualCostKrw?: number;
}

const workerName = process.env.HERMES_WORKER_NAME ?? "hermes-worker";
const MIN_WORKER_SECRET_LENGTH = 32;

export async function runWorkerOnce(client: WorkerDbClient, currentWorkerName = workerName): Promise<WorkerRunResult> {
  const { rows } = await client.query("select * from private.claim_creative_job($1)", [currentWorkerName]);
  const job = rows[0] as ClaimedCreativeJob | undefined;
  if (!job?.id) {
    console.log("No queued creative jobs.");
    return { claimed: false };
  }

  console.log(`Claimed creative job ${job.id}.`);

  try {
    const result = await processClaimedCreativeJob(job, currentWorkerName);
    await client.query("begin");
    try {
      const completed = await client.query("select * from private.complete_creative_job($1, $2, $3::jsonb)", [
        job.id,
        currentWorkerName,
        JSON.stringify(result)
      ]);
      const completedJob = completed.rows[0] as { status?: WorkerRunResult["status"] } | undefined;
      if (!completedJob?.status) {
        throw new Error("WORKER_COMPLETE_MISSED");
      }
      await recordPaidGenerationCostUsage(client, job, result, completedJob.status);
      await client.query("commit");
      return {
        claimed: true,
        jobId: job.id,
        status: completedJob.status
      };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failureResult = { error: message };
    await client.query("begin");
    try {
      const failed = await client.query("select * from private.fail_creative_job($1, $2, $3, $4::jsonb)", [
        job.id,
        currentWorkerName,
        message,
        JSON.stringify(failureResult)
      ]);
      const failedJob = failed.rows[0] as { status?: WorkerRunResult["status"] } | undefined;
      if (!failedJob?.status) {
        throw new Error("WORKER_FAIL_MISSED");
      }
      await recordPaidGenerationCostUsage(client, job, failureResult, failedJob.status);
      await client.query("commit");
      return {
        claimed: true,
        jobId: job.id,
        status: failedJob.status
      };
    } catch (failError) {
      await rollbackQuietly(client);
      throw failError;
    }
  }
}

export async function processClaimedCreativeJob(
  job: ClaimedCreativeJob,
  currentWorkerName = workerName,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<Record<string, unknown>> {
  if (job.job_type === "worker_test_fail") {
    throw new Error("WORKER_TEST_FAILURE");
  }
  if (isPaidGenerationJob(job.job_type) && isProductionRuntime(env)) {
    if (!isPaidGenerationProviderConfigured(env)) {
      throw new Error("PAID_GENERATION_WORKER_NOT_CONFIGURED");
    }
    return executePaidGenerationJob(job, currentWorkerName, env, fetchImpl);
  }

  return {
    worker: currentWorkerName,
    jobType: job.job_type,
    input: job.input_json ?? {},
    mockSafe: true
  };
}

function isPaidGenerationJob(jobType: string): boolean {
  return jobType === "image_generation" || jobType === "video_generation";
}

function isProductionRuntime(env: Record<string, string | undefined>): boolean {
  return env.NODE_ENV === "production" || env.VERCEL_ENV === "production";
}

async function recordPaidGenerationCostUsage(
  client: WorkerDbClient,
  job: ClaimedCreativeJob,
  result: Record<string, unknown>,
  status: WorkerRunResult["status"]
): Promise<void> {
  const cost = readPaidGenerationCostInput(job);
  if (!cost || (status !== "succeeded" && status !== "failed")) {
    return;
  }

  const actualCredits =
    status === "succeeded" ? readNumberField(result, "actualCredits") ?? cost.actualCredits ?? cost.estimatedCredits : 0;
  const actualCostKrw =
    status === "succeeded" ? readNumberField(result, "actualCostKrw") ?? cost.actualCostKrw ?? cost.estimatedCostKrw : 0;

  await client.query(
    `insert into public.cost_usage_logs (
      tenant_id,
      created_by,
      provider,
      model,
      operation_type,
      estimated_credits,
      actual_credits,
      estimated_cost_krw,
      actual_cost_krw,
      related_job_id,
      status
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      job.tenant_id,
      job.created_by ?? null,
      cost.provider,
      cost.model ?? null,
      cost.operationType,
      cost.estimatedCredits,
      actualCredits,
      cost.estimatedCostKrw,
      actualCostKrw,
      cost.relatedJobId,
      status
    ]
  );
}

function readPaidGenerationCostInput(job: ClaimedCreativeJob): PaidGenerationCostInput | undefined {
  const input = readRecord(job.input_json);
  if (!input || readStringField(input, "operation") !== "ai_paid_generation") {
    return undefined;
  }

  const cost = readRecord(input.cost) ?? {};
  const relatedJobId = readStringField(cost, "relatedJobId") ?? readStringField(input, "costUsageRelatedJobId");
  if (!relatedJobId) {
    return undefined;
  }

  return {
    provider: readStringField(cost, "provider") ?? "unknown",
    model: readStringField(cost, "model"),
    operationType: readStringField(cost, "operationType") ?? readStringField(input, "operationType") ?? job.job_type,
    estimatedCredits: readNumberField(cost, "estimatedCredits") ?? 0,
    estimatedCostKrw: readNumberField(cost, "estimatedCostKrw") ?? 0,
    relatedJobId,
    actualCredits: readNumberField(cost, "actualCredits"),
    actualCostKrw: readNumberField(cost, "actualCostKrw")
  };
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function readStringField(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key];
  return typeof value === "string" ? value : undefined;
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

async function rollbackQuietly(client: WorkerDbClient): Promise<void> {
  try {
    await client.query("rollback");
  } catch {
    // The original worker error is more useful than a rollback failure here.
  }
}

async function main() {
  const { databaseUrl } = readWorkerRuntimeEnv(process.env);

  const client = new Client({
    connectionString: databaseUrl
  });

  await client.connect();
  try {
    await runWorkerOnce(client);
  } finally {
    await client.end();
  }
}

if (process.argv[1]?.endsWith("hermes-worker.ts") || process.argv[1]?.endsWith("hermes-worker.js")) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export function readWorkerRuntimeEnv(env: Record<string, string | undefined>): { databaseUrl: string } {
  const databaseUrl = env.SUPABASE_DB_URL?.trim();
  if (!databaseUrl) {
    throw new Error("SUPABASE_DB_URL_REQUIRED");
  }

  const workerSecret = env.HERMES_WORKER_SECRET?.trim();
  if (!workerSecret) {
    throw new Error("HERMES_WORKER_SECRET_REQUIRED");
  }
  if (workerSecret.length < MIN_WORKER_SECRET_LENGTH) {
    throw new Error("HERMES_WORKER_SECRET_WEAK");
  }

  return { databaseUrl };
}
