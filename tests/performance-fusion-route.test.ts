import { afterEach, describe, expect, it } from "vitest";
import { POST as performanceFusionRoute } from "@/app/api/performance-fusion/reports/route";
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
  return new Request("http://localhost/api/performance-fusion/reports", {
    method: "POST",
    headers: {
      "x-tenant-id": tenantId
    },
    body: JSON.stringify(body)
  });
}

describe("performance fusion route", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("requires production authentication before creating a performance fusion report", async () => {
    clearEnv();
    mutableEnv.NODE_ENV = "production";

    const response = await performanceFusionRoute(
      request({
        creativeScores: [],
        diagnosis: {
          dataSufficiency: "weak_signal",
          stages: []
        }
      })
    );
    const body = await json(response);

    expect(response.status).toBe(401);
    expect((body.error as { code?: string }).code).toBe("SUPABASE_AUTH_REQUIRED");
  });

  it("persists a tenant-scoped performance fusion report instead of returning an ephemeral report only", async () => {
    setMockEnv();
    const repository = new MemoryHermesRepository();

    const response = await performanceFusionRoute(
      request({
        assetId: "asset-1",
        bottleneckJobId: "job-1",
        creativeScores: [{ name: "Hook Score", value: 40, evidence: ["weak hook"] }],
        diagnosis: {
          dataSufficiency: "actionable_signal",
          stages: [
            {
              stage: "Hook/Attention",
              score: 40,
              confidence: "actionable_signal",
              evidence: ["CTR 0.6%"],
              recommendation: "test hook"
            }
          ]
        }
      })
    );
    const body = await json(response);
    const stored = await repository.getPerformanceFusionReport(
      request({}),
      context,
      String(body.id)
    );

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      tenantId,
      createdBy: mockUserId,
      assetId: "asset-1",
      bottleneckJobId: "job-1",
      languageGuard: "correlation_not_causation"
    });
    expect(stored).toMatchObject({
      id: body.id,
      tenantId,
      createdBy: mockUserId,
      assetId: "asset-1",
      bottleneckJobId: "job-1",
      languageGuard: "correlation_not_causation"
    });
  });
});
