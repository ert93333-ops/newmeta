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
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
] as const;

const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const mutableEnv = process.env as unknown as Record<string, string | undefined>;
const tenantId = "00000000-0000-0000-0000-000000000001";

const approver: UserContext = {
  userId: "cost-approval-owner",
  tenantId,
  role: "owner"
};

const baseEstimate: CostEstimateInput = {
  operationType: "variant_batch",
  units: 1,
  estimatedCredits: 5,
  settings: {
    providerName: "mock-ai",
    creditUnitCostKrw: 100,
    dailyCostCapKrw: 5000,
    hardDailyCapKrw: 7500,
    referenceDailyAdBudgetKrw: 50000
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

describe("cost estimate route approval request flow", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("returns approval_required without creating an approval by default", async () => {
    clearEnv();
    setEnv("HERMES_AUTH_MODE", "mock");

    const response = await estimateCostRoute(jsonRequest("http://localhost/api/cost/estimate", baseEstimate));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "approval_required",
      estimatedCostKrw: 500,
      requiresApproval: true
    });
    expect(body.approval).toBeUndefined();
  });

  it("creates a pending paid generation approval only when explicitly requested", async () => {
    clearEnv();
    setEnv("HERMES_AUTH_MODE", "mock");
    const repository = new MemoryHermesRepository();

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
  });

  it("does not create an approval when the cost guard blocks the operation", async () => {
    clearEnv();
    setEnv("HERMES_AUTH_MODE", "mock");

    const response = await estimateCostRoute(
      jsonRequest("http://localhost/api/cost/estimate", {
        ...baseEstimate,
        estimatedCredits: 100,
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

  it("supports the estimate to approval to variant execution flow without budget mutation", async () => {
    clearEnv();
    setEnv("HERMES_AUTH_MODE", "mock");
    const repository = new MemoryHermesRepository();

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

    expect(variantResponse.status).toBe(201);
    expect(variantBody.approval).toMatchObject({
      id: estimateBody.approval.id,
      status: "executed",
      executionResultJson: {
        operation: "ai_paid_generation",
        operationType: "variant_batch"
      }
    });
    expect(JSON.stringify(variantBody)).not.toContain("daily_budget");
  });
});
