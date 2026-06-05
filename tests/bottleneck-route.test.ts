import { afterEach, describe, expect, it } from "vitest";
import { POST as bottleneckRoute } from "@/app/api/bottleneck/jobs/route";
import { MemoryHermesRepository } from "@/lib/repositories/hermes-repository";
import type { UserContext } from "@/lib/types";

const ENV_KEYS = [
  "NODE_ENV",
  "VERCEL_ENV",
  "HERMES_AUTH_MODE",
  "HERMES_DEFAULT_TENANT_ID",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
] as const;

const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const mutableEnv = process.env as unknown as Record<string, string | undefined>;
const tenantId = "00000000-0000-0000-0000-000000000001";
const mockUserId = "00000000-0000-0000-0000-000000000010";
const context: UserContext = {
  userId: mockUserId,
  tenantId,
  role: "marketer"
};

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

function clearEnv(): void {
  for (const key of ENV_KEYS) {
    delete mutableEnv[key];
  }
}

function setMockEnv(): void {
  clearEnv();
  mutableEnv.HERMES_AUTH_MODE = "mock";
  mutableEnv.HERMES_DEFAULT_TENANT_ID = tenantId;
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function request(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/bottleneck/jobs", {
    method: "POST",
    headers: {
      "x-tenant-id": tenantId
    },
    body: JSON.stringify(body)
  });
}

describe("bottleneck route", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("requires production authentication before creating a bottleneck analysis job", async () => {
    clearEnv();
    mutableEnv.NODE_ENV = "production";

    const response = await bottleneckRoute(
      request({
        spend: 1000,
        impressions: 1000,
        reach: 800,
        frequency: 1.2,
        clicks: 12,
        linkClicks: 10,
        outboundClicks: 8,
        landingPageViews: 6,
        purchases: 0,
        addToCart: 1,
        ctr: 1.2,
        cpc: 100,
        cpm: 10000
      })
    );
    const body = await json(response);

    expect(response.status).toBe(401);
    expect((body.error as { code?: string }).code).toBe("SUPABASE_AUTH_REQUIRED");
  });

  it("persists dedicated bottleneck analysis tables alongside the generic job surface", async () => {
    setMockEnv();
    const repository = new MemoryHermesRepository();

    const response = await bottleneckRoute(
      request({
        spend: 42000,
        impressions: 3200,
        reach: 2500,
        frequency: 1.2,
        clicks: 90,
        linkClicks: 110,
        outboundClicks: 100,
        landingPageViews: 90,
        purchases: 4,
        addToCart: 12,
        ctr: 2.8,
        cpc: 380,
        cpm: 12000,
        purchaseRoas: 2.1
      })
    );
    const body = await json(response);
    const persistedJob = await repository.getBottleneckAnalysisJob(request({}), context, String(body.id));
    const persistedStages = await repository.listBottleneckStageScores(request({}), context, String(body.id));
    const persistedHypotheses = await repository.listBottleneckHypotheses(request({}), context, String(body.id));

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      id: expect.any(String),
      tenantId,
      createdBy: mockUserId,
      type: "bottleneck_diagnosis",
      status: "succeeded"
    });
    expect((body.result as { stages?: unknown[] }).stages).toHaveLength(11);
    expect(Array.isArray((body.result as { hypotheses?: unknown[] }).hypotheses)).toBe(true);
    expect(persistedJob).toMatchObject({
      id: body.id,
      tenantId,
      createdBy: mockUserId,
      status: "succeeded",
      dataSufficiency: "high_confidence"
    });
    expect(persistedStages).toHaveLength(11);
    expect(persistedHypotheses).toHaveLength((body.result as { hypotheses?: unknown[] }).hypotheses?.length ?? 0);
  });
});
