import { afterEach, describe, expect, it } from "vitest";
import { approveRequest } from "@/lib/approval/approval-policy";
import { MemoryHermesRepository } from "@/lib/repositories/hermes-repository";
import { POST as estimateCostRoute } from "@/app/api/cost/estimate/route";
import { POST as designVariantsRoute } from "@/app/api/variants/design/route";
import type { ApprovalRequest, CostEstimateInput, UserContext } from "@/lib/types";

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

const baseEstimate: CostEstimateInput = {
  operationType: "variant_batch",
  units: 1,
  settings: {
    providerName: "mock-ai"
  }
};

function setEnv(key: (typeof ENV_KEYS)[number], value: string): void {
  mutableEnv[key] = value;
}

function unsetEnv(key: (typeof ENV_KEYS)[number]): void {
  delete mutableEnv[key];
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = ORIGINAL_ENV[key];
    if (value === undefined) {
      unsetEnv(key);
    } else {
      setEnv(key, value);
    }
  }
}

function clearEnv(): void {
  for (const key of ENV_KEYS) {
    unsetEnv(key);
  }
}

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

function useMockTenant(tenantId: string): UserContext {
  setEnv("HERMES_AUTH_MODE", "mock");
  setEnv("HERMES_DEFAULT_TENANT_ID", tenantId);
  return {
    userId: "cost-approval-owner",
    tenantId,
    role: "owner"
  };
}

async function saveServerCostSettings(
  repository: MemoryHermesRepository,
  context: UserContext,
  overrides?: Partial<CostEstimateInput["settings"]>
) {
  await repository.saveIntegrationSettings(jsonRequest("http://localhost/api/test", {}), {
    tenantId: context.tenantId,
    createdBy: context.userId,
    provider: "mock-ai",
    settingsJson: {
      providerName: "mock-ai",
      creditUnitCostKrw: 100,
      imageGenerationCreditCost: 5,
      videoGenerationCreditCost: 30,
      analysisCreditCost: 1,
      dailyCostCapKrw: 5000,
      hardDailyCapKrw: 7500,
      referenceDailyAdBudgetKrw: 50000,
      ...overrides
    }
  });
}

describe("cost estimate route approval request flow", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("returns approval_required without creating an approval by default", async () => {
    clearEnv();
    const context = useMockTenant("00000000-0000-0000-0000-000000000101");
    await saveServerCostSettings(new MemoryHermesRepository(), context);

    const response = await estimateCostRoute(jsonRequest("http://localhost/api/cost/estimate", baseEstimate));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "approval_required",
      estimatedCostKrw: 500,
      requiresApproval: true
    });
    expect(body.usageSummary).toEqual({
      todayActualCostKrw: 0,
      monthActualCostKrw: 0
    });
    expect(body.approval).toBeUndefined();
  });

  it("creates a pending paid generation approval only when explicitly requested", async () => {
    clearEnv();
    const approver = useMockTenant("00000000-0000-0000-0000-000000000102");
    const repository = new MemoryHermesRepository();
    await saveServerCostSettings(repository, approver);

    const response = await estimateCostRoute(
      jsonRequest("http://localhost/api/cost/estimate", {
        ...baseEstimate,
        approvalRequest: {
          create: true,
          objectId: "creative-control-1",
          reason: "Generate approved A/B variants."
        }
      })
    );
    const body = await response.json();
    const stored = await repository.getApproval(
      jsonRequest("http://localhost/api/test", {}),
      approver,
      body.approval.id
    );

    expect(response.status).toBe(201);
    expect(body.status).toBe("approval_required");
    expect(body.approval).toMatchObject({
      action: "ai_paid_generation",
      objectType: "variant_batch",
      objectId: "creative-control-1",
      status: "pending",
      afterJson: {
        operationType: "variant_batch",
        estimatedCostKrw: 500,
        providerName: "mock-ai"
      }
    });
    expect(body.guard).toMatchObject({
      riskLevel: "draft",
      requiresSecondApproval: false
    });
    expect(stored?.id).toBe(body.approval.id);

    const usage = await repository.listCostUsage(jsonRequest("http://localhost/api/test", {}), approver);
    expect(usage.at(-1)).toMatchObject({
      operationType: "variant_batch",
      estimatedCostKrw: 500,
      relatedJobId: body.approval.id,
      status: "estimated"
    });
  });

  it("does not create an approval when the cost guard blocks the operation", async () => {
    clearEnv();
    const context = useMockTenant("00000000-0000-0000-0000-000000000103");
    await saveServerCostSettings(new MemoryHermesRepository(), context);

    const response = await estimateCostRoute(
      jsonRequest("http://localhost/api/cost/estimate", {
        ...baseEstimate,
        units: 20,
        approvalRequest: {
          create: true,
          objectId: "creative-control-1"
        }
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("blocked");
    expect(body.approval).toBeUndefined();
  });

  it("uses persisted server usage instead of client-supplied usage totals", async () => {
    clearEnv();
    const approver = useMockTenant("00000000-0000-0000-0000-000000000104");
    const repository = new MemoryHermesRepository();
    await saveServerCostSettings(repository, approver);
    await repository.saveCostUsage(jsonRequest("http://localhost/api/test", {}), {
      tenantId: approver.tenantId,
      userId: approver.userId,
      provider: "mock-ai",
      operationType: "image_generation",
      estimatedCredits: 48,
      estimatedCostKrw: 4800,
      status: "estimated",
      createdAt: new Date().toISOString()
    });

    const response = await estimateCostRoute(
      jsonRequest("http://localhost/api/cost/estimate", {
        ...baseEstimate,
        todayActualCostKrw: 0,
        monthActualCostKrw: 0,
        approvalRequest: {
          create: true,
          objectId: "creative-control-1"
        }
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "blocked",
      usageSummary: {
        todayActualCostKrw: 4800,
        monthActualCostKrw: 4800
      }
    });
    expect(body.approval).toBeUndefined();
  });

  it("supports the estimate to approval to variant execution flow without budget mutation", async () => {
    clearEnv();
    const approver = useMockTenant("00000000-0000-0000-0000-000000000105");
    const repository = new MemoryHermesRepository();
    await saveServerCostSettings(repository, approver);

    const estimateResponse = await estimateCostRoute(
      jsonRequest("http://localhost/api/cost/estimate", {
        ...baseEstimate,
        approvalRequest: {
          create: true,
          objectId: "creative-control-1"
        }
      })
    );
    const estimateBody = (await estimateResponse.json()) as { approval: ApprovalRequest };
    const approved = approveRequest(estimateBody.approval, approver);
    await repository.updateApproval(jsonRequest("http://localhost/api/test", {}), approved);

    const variantResponse = await designVariantsRoute(
      jsonRequest("http://localhost/api/variants/design", {
        controlId: "creative-control-1",
        hypothesis: "Hook clarity improves click-through rate.",
        variable: "hook",
        approvalRequestId: estimateBody.approval.id
      })
    );
    const variantBody = await variantResponse.json();
    const usage = await repository.listCostUsage(jsonRequest("http://localhost/api/test", {}), approver);
    const summary = await repository.summarizeCostUsage(jsonRequest("http://localhost/api/test", {}), approver);

    expect(variantResponse.status).toBe(201);
    expect(variantBody.approval).toMatchObject({
      id: estimateBody.approval.id,
      status: "executed",
      executionResultJson: {
        operation: "ai_paid_generation",
        operationType: "variant_batch"
      }
    });
    expect(usage.filter((item) => typeof item === "object" && item !== null && "relatedJobId" in item)).toHaveLength(2);
    expect(usage.at(-1)).toMatchObject({
      relatedJobId: estimateBody.approval.id,
      status: "succeeded",
      actualCostKrw: 500
    });
    expect(summary).toEqual({
      todayActualCostKrw: 500,
      monthActualCostKrw: 500
    });
    expect(JSON.stringify(variantBody)).not.toContain("daily_budget");
  });

  it("fails closed when server cost settings are missing for the provider", async () => {
    clearEnv();
    useMockTenant("00000000-0000-0000-0000-000000000106");

    const response = await estimateCostRoute(jsonRequest("http://localhost/api/cost/estimate", baseEstimate));
    const body = await response.json();

    expect(response.status).toBe(501);
    expect(body.error).toMatchObject({
      code: "COST_SETTINGS_NOT_CONFIGURED",
      details: {
        providerName: "mock-ai"
      }
    });
  });

  it("ignores client-supplied caps and pricing in favor of persisted server cost settings", async () => {
    clearEnv();
    const approver = useMockTenant("00000000-0000-0000-0000-000000000107");
    const repository = new MemoryHermesRepository();
    await saveServerCostSettings(repository, approver, {
      creditUnitCostKrw: 100,
      imageGenerationCreditCost: 5,
      dailyCostCapKrw: 5000
    });

    const response = await estimateCostRoute(
      jsonRequest("http://localhost/api/cost/estimate", {
        ...baseEstimate,
        settings: {
          providerName: "mock-ai",
          creditUnitCostKrw: 1,
          imageGenerationCreditCost: 1,
          dailyCostCapKrw: 999999
        }
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "approval_required",
      estimatedCostKrw: 500,
      effectiveDailyCapKrw: 5000
    });
  });

  it("fails closed when persisted server cost settings are malformed", async () => {
    clearEnv();
    const approver = useMockTenant("00000000-0000-0000-0000-000000000108");
    const repository = new MemoryHermesRepository();
    await repository.saveIntegrationSettings(jsonRequest("http://localhost/api/test", {}), {
      tenantId: approver.tenantId,
      createdBy: approver.userId,
      provider: "mock-ai",
      settingsJson: "not-an-object"
    });

    const response = await estimateCostRoute(jsonRequest("http://localhost/api/cost/estimate", baseEstimate));
    const body = await response.json();

    expect(response.status).toBe(501);
    expect(body.error).toMatchObject({
      code: "COST_SETTINGS_INVALID",
      details: {
        providerName: "mock-ai"
      }
    });
  });
});
