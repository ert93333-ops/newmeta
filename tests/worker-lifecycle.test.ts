import { describe, expect, it } from "vitest";
import { processClaimedCreativeJob, runWorkerOnce } from "../worker/hermes-worker";

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
    expect(queries[1].sql).toContain("private.complete_creative_job");
    expect(queries[1].params?.[0]).toBe("00000000-0000-0000-0000-000000000111");
    expect(queries[1].params?.[1]).toBe("test-worker");
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
    expect(queries[1].sql).toContain("private.fail_creative_job");
    expect(queries[1].params?.[2]).toBe("WORKER_TEST_FAILURE");
  });

  it("does nothing when there is no queued job", async () => {
    const { client, queries } = fakeClientFor(undefined, "succeeded");

    const result = await runWorkerOnce(client, "test-worker");

    expect(result).toEqual({ claimed: false });
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain("private.claim_creative_job");
  });
});
