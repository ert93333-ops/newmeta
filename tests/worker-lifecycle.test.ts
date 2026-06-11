import { describe, expect, it } from "vitest";
import { processClaimedCreativeJob, readWorkerRuntimeEnv, runWorkerOnce } from "../worker/hermes-worker";

function fakeClientFor(job: Record<string, unknown> | undefined, terminalStatus: "succeeded" | "queued" | "failed") {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];

  return {
    queries,
    client: {
      async query(sql: string, params?: unknown[]) {
        queries.push({ sql, params });
        if (sql.includes("private.claim_creative_job")) {
          return { rows: job ? [job] : [] };
        }
        if (sql.includes("private.complete_creative_job")) {
          return { rows: [{ status: terminalStatus }] };
        }
        if (sql.includes("private.fail_creative_job")) {
          return { rows: [{ status: terminalStatus }] };
        }
        return { rows: [] };
      }
    }
  };
}

describe("Hermes worker lifecycle", () => {
  it("returns a mock-safe deterministic result for claimed jobs", () => {
    expect(
      processClaimedCreativeJob(
        {
          id: "00000000-0000-0000-0000-000000000111",
          tenant_id: "00000000-0000-0000-0000-000000000001",
          job_type: "render",
          input_json: { assetId: "asset-1" }
        },
        "test-worker"
      )
    ).toEqual({
      worker: "test-worker",
      jobType: "render",
      input: { assetId: "asset-1" },
      mockSafe: true
    });
  });

  it("fails closed for paid generation jobs in production until a real generation worker is configured", () => {
    expect(() =>
      processClaimedCreativeJob(
        {
          id: "00000000-0000-0000-0000-000000000112",
          tenant_id: "00000000-0000-0000-0000-000000000001",
          job_type: "image_generation",
          input_json: {
            operation: "ai_paid_generation",
            operationType: "image_generation"
          }
        },
        "test-worker",
        { NODE_ENV: "production" }
      )
    ).toThrow("PAID_GENERATION_WORKER_NOT_CONFIGURED");
  });

  it("completes a claimed job through the private DB function", async () => {
    const { client, queries } = fakeClientFor(
      {
        id: "00000000-0000-0000-0000-000000000111",
        tenant_id: "00000000-0000-0000-0000-000000000001",
        job_type: "render",
        input_json: { assetId: "asset-1" }
      },
      "succeeded"
    );

    const result = await runWorkerOnce(client, "test-worker");

    expect(result).toEqual({
      claimed: true,
      jobId: "00000000-0000-0000-0000-000000000111",
      status: "succeeded"
    });
    expect(queries[0].sql).toContain("private.claim_creative_job");
    expect(queries[1].sql).toBe("begin");
    expect(queries[2].sql).toContain("private.complete_creative_job");
    expect(queries[2].params?.[0]).toBe("00000000-0000-0000-0000-000000000111");
    expect(queries[2].params?.[1]).toBe("test-worker");
    expect(queries.at(-1)?.sql).toBe("commit");
  });

  it("records a final succeeded cost usage row for paid generation jobs", async () => {
    const { client, queries } = fakeClientFor(
      {
        id: "00000000-0000-0000-0000-000000000333",
        tenant_id: "00000000-0000-0000-0000-000000000001",
        created_by: "00000000-0000-0000-0000-000000000010",
        job_type: "image_generation",
        input_json: {
          operation: "ai_paid_generation",
          operationType: "image_generation",
          costUsageRelatedJobId: "00000000-0000-0000-0000-000000000777",
          cost: {
            provider: "mock-ai",
            model: "mock-generation",
            operationType: "image_generation",
            estimatedCredits: 5,
            estimatedCostKrw: 500,
            relatedJobId: "00000000-0000-0000-0000-000000000777"
          }
        }
      },
      "succeeded"
    );

    await runWorkerOnce(client, "test-worker");

    const costInsert = queries.find((query) => query.sql.includes("insert into public.cost_usage_logs"));
    expect(costInsert?.params).toEqual([
      "00000000-0000-0000-0000-000000000001",
      "00000000-0000-0000-0000-000000000010",
      "mock-ai",
      "mock-generation",
      "image_generation",
      5,
      5,
      500,
      500,
      "00000000-0000-0000-0000-000000000777",
      "succeeded"
    ]);
  });

  it("routes worker failures through the private retry/fail DB function", async () => {
    const { client, queries } = fakeClientFor(
      {
        id: "00000000-0000-0000-0000-000000000222",
        tenant_id: "00000000-0000-0000-0000-000000000001",
        job_type: "worker_test_fail"
      },
      "queued"
    );

    const result = await runWorkerOnce(client, "test-worker");

    expect(result).toEqual({
      claimed: true,
      jobId: "00000000-0000-0000-0000-000000000222",
      status: "queued"
    });
    expect(queries[1].sql).toBe("begin");
    expect(queries[2].sql).toContain("private.fail_creative_job");
    expect(queries[2].params?.[2]).toBe("WORKER_TEST_FAILURE");
    expect(queries.some((query) => query.sql.includes("insert into public.cost_usage_logs"))).toBe(false);
    expect(queries.at(-1)?.sql).toBe("commit");
  });

  it("records a final failed cost usage row only after paid generation retries are exhausted", async () => {
    const { client, queries } = fakeClientFor(
      {
        id: "00000000-0000-0000-0000-000000000444",
        tenant_id: "00000000-0000-0000-0000-000000000001",
        created_by: "00000000-0000-0000-0000-000000000010",
        job_type: "worker_test_fail",
        input_json: {
          operation: "ai_paid_generation",
          operationType: "video_generation",
          costUsageRelatedJobId: "00000000-0000-0000-0000-000000000888",
          cost: {
            provider: "mock-ai",
            model: "mock-video",
            operationType: "video_generation",
            estimatedCredits: 30,
            estimatedCostKrw: 3000,
            relatedJobId: "00000000-0000-0000-0000-000000000888"
          }
        }
      },
      "failed"
    );

    const result = await runWorkerOnce(client, "test-worker");

    expect(result).toEqual({
      claimed: true,
      jobId: "00000000-0000-0000-0000-000000000444",
      status: "failed"
    });
    const costInsert = queries.find((query) => query.sql.includes("insert into public.cost_usage_logs"));
    expect(costInsert?.params).toEqual([
      "00000000-0000-0000-0000-000000000001",
      "00000000-0000-0000-0000-000000000010",
      "mock-ai",
      "mock-video",
      "video_generation",
      30,
      0,
      3000,
      0,
      "00000000-0000-0000-0000-000000000888",
      "failed"
    ]);
  });

  it("does nothing when there is no queued job", async () => {
    const { client, queries } = fakeClientFor(undefined, "succeeded");

    const result = await runWorkerOnce(client, "test-worker");

    expect(result).toEqual({ claimed: false });
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain("private.claim_creative_job");
  });

  it("requires server-only worker runtime env before opening the DB connection", () => {
    expect(() => readWorkerRuntimeEnv({})).toThrow("SUPABASE_DB_URL_REQUIRED");
    expect(() =>
      readWorkerRuntimeEnv({
        SUPABASE_DB_URL: "postgresql://postgres:secret@db.project.supabase.co:5432/postgres"
      })
    ).toThrow("HERMES_WORKER_SECRET_REQUIRED");
    expect(() =>
      readWorkerRuntimeEnv({
        SUPABASE_DB_URL: "postgresql://postgres:secret@db.project.supabase.co:5432/postgres",
        HERMES_WORKER_SECRET: "short"
      })
    ).toThrow("HERMES_WORKER_SECRET_WEAK");

    expect(
      readWorkerRuntimeEnv({
        SUPABASE_DB_URL: "postgresql://postgres:secret@db.project.supabase.co:5432/postgres",
        HERMES_WORKER_SECRET: "worker-secret-with-at-least-32-characters"
      })
    ).toEqual({
      databaseUrl: "postgresql://postgres:secret@db.project.supabase.co:5432/postgres"
    });
  });
});
