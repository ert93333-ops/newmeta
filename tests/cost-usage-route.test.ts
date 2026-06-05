import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as getCostUsage } from "@/app/api/cost/usage/route";
import { MemoryHermesRepository } from "@/lib/repositories/hermes-repository";
import type { UserContext } from "@/lib/types";

const ENV_KEYS = ["HERMES_AUTH_MODE", "HERMES_DEFAULT_TENANT_ID"] as const;
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const mutableEnv = process.env as unknown as Record<string, string | undefined>;

const tenantId = "00000000-0000-0000-0000-000000000111";
const owner: UserContext = {
  userId: "cost-owner",
  tenantId,
  role: "owner"
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

function setMockEnv(): void {
  mutableEnv.HERMES_AUTH_MODE = "mock";
  mutableEnv.HERMES_DEFAULT_TENANT_ID = tenantId;
}

function request(url: string): Request {
  return new Request(url, {
    method: "GET",
    headers: {
      "x-tenant-id": tenantId
    }
  });
}

describe("cost usage route", () => {
  afterEach(() => {
    restoreEnv();
    vi.unstubAllGlobals();
  });

  it("returns server-owned provider policy with effective cap", async () => {
    setMockEnv();
    const repository = new MemoryHermesRepository();
    await repository.saveIntegrationSettings(request("http://localhost/api/test"), {
      tenantId,
      createdBy: owner.userId,
      provider: "mock-ai",
      settingsJson: {
        providerName: "mock-ai",
        planName: "Starter",
        dailyCostCapKrw: 6000,
        hardDailyCapKrw: 7500,
        monthlyCostCapKrw: 120000,
        referenceDailyAdBudgetKrw: 50000
      }
    });
    await repository.saveCostUsage(request("http://localhost/api/test"), {
      tenantId,
      userId: owner.userId,
      operationType: "image_generation",
      provider: "mock-ai",
      estimatedCredits: 5,
      estimatedCostKrw: 2200,
      actualCostKrw: 2200,
      status: "succeeded"
    });

    const response = await getCostUsage(request("http://localhost/api/cost/usage?providerName=mock-ai"));
    const body = (await response.json()) as {
      summary: { todayActualCostKrw?: number };
      policy: {
        providerName?: string;
        planName?: string;
        dailyCostCapKrw?: number;
        hardDailyCapKrw?: number;
        monthlyCostCapKrw?: number;
        referenceDailyAdBudgetKrw?: number;
        effectiveDailyCapKrw?: number;
        budgetMutation?: string;
      };
    };

    expect(response.status).toBe(200);
    expect(body.summary.todayActualCostKrw).toBe(2200);
    expect(body.policy).toMatchObject({
      providerName: "mock-ai",
      planName: "Starter",
      dailyCostCapKrw: 6000,
      hardDailyCapKrw: 7500,
      monthlyCostCapKrw: 120000,
      referenceDailyAdBudgetKrw: 50000,
      effectiveDailyCapKrw: 5000,
      budgetMutation: "hard_blocked"
    });
  });

  it("fails closed when providerName is missing", async () => {
    setMockEnv();

    const response = await getCostUsage(request("http://localhost/api/cost/usage"));
    const body = (await response.json()) as { error?: { code?: string } };

    expect(response.status).toBe(400);
    expect(body.error?.code).toBe("COST_PROVIDER_REQUIRED");
  });

  it("fails closed when server cost settings are not configured", async () => {
    setMockEnv();

    const response = await getCostUsage(request("http://localhost/api/cost/usage?providerName=missing-provider"));
    const body = (await response.json()) as { error?: { code?: string } };

    expect(response.status).toBe(501);
    expect(body.error?.code).toBe("COST_SETTINGS_NOT_CONFIGURED");
  });
});
