import { Client } from "pg";

export interface ClaimedCreativeJob {
  id: string;
  tenant_id: string;
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

const workerName = process.env.HERMES_WORKER_NAME ?? "hermes-worker";

export async function runWorkerOnce(client: WorkerDbClient, currentWorkerName = workerName): Promise<WorkerRunResult> {
  const { rows } = await client.query("select * from private.claim_creative_job($1)", [currentWorkerName]);
  const job = rows[0] as ClaimedCreativeJob | undefined;
  if (!job?.id) {
    console.log("No queued creative jobs.");
    return { claimed: false };
  }

  console.log(`Claimed creative job ${job.id}.`);

  try {
    const result = processClaimedCreativeJob(job, currentWorkerName);
    const completed = await client.query("select * from private.complete_creative_job($1, $2, $3::jsonb)", [
      job.id,
      currentWorkerName,
      JSON.stringify(result)
    ]);
    const completedJob = completed.rows[0] as { status?: WorkerRunResult["status"] } | undefined;
    if (!completedJob?.status) {
      throw new Error("WORKER_COMPLETE_MISSED");
    }
    return {
      claimed: true,
      jobId: job.id,
      status: completedJob.status
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = await client.query("select * from private.fail_creative_job($1, $2, $3, $4::jsonb)", [
      job.id,
      currentWorkerName,
      message,
      JSON.stringify({ error: message })
    ]);
    const failedJob = failed.rows[0] as { status?: WorkerRunResult["status"] } | undefined;
    if (!failedJob?.status) {
      throw new Error("WORKER_FAIL_MISSED");
    }
    return {
      claimed: true,
      jobId: job.id,
      status: failedJob.status
    };
  }
}

export function processClaimedCreativeJob(
  job: ClaimedCreativeJob,
  currentWorkerName = workerName
): Record<string, unknown> {
  if (job.job_type === "worker_test_fail") {
    throw new Error("WORKER_TEST_FAILURE");
  }

  return {
    worker: currentWorkerName,
    jobType: job.job_type,
    input: job.input_json ?? {},
    mockSafe: true
  };
}

async function main() {
  const databaseUrl = process.env.SUPABASE_DB_URL;
  if (!databaseUrl) {
    throw new Error("SUPABASE_DB_URL is required for the worker.");
  }

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
