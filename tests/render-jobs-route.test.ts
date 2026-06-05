import { afterEach, describe, expect, it } from "vitest";
import { approveRequest, createApprovalRequest } from "@/lib/approval/approval-policy";
import { MemoryHermesRepository } from "@/lib/repositories/hermes-repository";
import { POST as renderJobsRoute } from "@/app/api/render/jobs/route";
import type { CostEstimateInput, CreativeManifest, UserContext } from "@/lib/types";

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

const baseManifest: CreativeManifest = {
  asset: {
    type: "image",
    width: 1080,
    height: 1350
  },
  declaredPrice: "9,900원",
  textBoxes: [
    {
      text: "9,900원",
      x: 120,
      y: 140,
      width: 500,
      height: 80,
      role: "price"
    },
    {
      text: "구매하기",
      x: 120,
      y: 1100,
      width: 220,
      height: 70,
      role: "cta"
    }
  ]
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

function useMockTenant(tenantId: string): UserContext {
  setEnv("HERMES_AUTH_MODE", "mock");
  setEnv("HERMES_DEFAULT_TENANT_ID", tenantId);
  return {
    userId: "render-approval-owner",
    tenantId,
    role: "owner"
  };
}

function renderRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/render/jobs", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

function approvedPaidGenerationApproval(
  operationType: Extract<CostEstimateInput["operationType"], "image_generation" | "video_generation">,
  tenantId: string
) {
  const requester: UserContext = {
    userId: `render-requester-${operationType}`,
    tenantId,
    role: "marketer"
  };
  const approver: UserContext = {
    userId: `render-approver-${operationType}`,
    tenantId,
    role: "owner"
  };

  return approveRequest(
    createApprovalRequest({
      context: requester,
      action: "ai_paid_generation",
      objectType: operationType,
      objectId: `${operationType}-job`,
      afterJson: {
        operationType,
        providerName: "mock-ai",
        model: "mock-generation",
        estimatedCredits: operationType === "video_generation" ? 30 : 5,
        estimatedCostKrw: operationType === "video_generation" ? 3000 : 500
      }
    }),
    approver
  );
}

describe("render jobs route", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("keeps the existing free render checker path approval-free", async () => {
    clearEnv();
    useMockTenant("00000000-0000-0000-0000-000000000301");

    const response = await renderJobsRoute(renderRequest(baseManifest as unknown as Record<string, unknown>));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      type: "render",
      status: "succeeded",
      result: {
        finalImage: "ready_without_guides",
        qaImage: "ready_with_safezone_overlay"
      }
    });
  });

  it("requires approval before queueing paid image generation", async () => {
    clearEnv();
    useMockTenant("00000000-0000-0000-0000-000000000302");

    const response = await renderJobsRoute(
      renderRequest({
        operationType: "image_generation",
        prompt: "Generate one approved image creative."
      })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("PAID_OPERATION_APPROVAL_REQUIRED");
    expect(body.error.details.operationType).toBe("image_generation");
  });

  it("rejects paid generation approvals for the wrong operation type", async () => {
    clearEnv();
    const executor = useMockTenant("00000000-0000-0000-0000-000000000303");
    const repository = new MemoryHermesRepository();
    const approval = approvedPaidGenerationApproval("video_generation", executor.tenantId);
    await repository.saveApproval(renderRequest({}), approval);

    const response = await renderJobsRoute(
      renderRequest({
        operationType: "image_generation",
        approvalRequestId: approval.id,
        prompt: "Generate one approved image creative."
      })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("PAID_OPERATION_APPROVAL_REQUIRED");
  });

  it("queues a paid generation worker job and consumes the approval", async () => {
    clearEnv();
    const executor = useMockTenant("00000000-0000-0000-0000-000000000304");
    const repository = new MemoryHermesRepository();
    const approval = approvedPaidGenerationApproval("image_generation", executor.tenantId);
    await repository.saveApproval(renderRequest({}), approval);

    const response = await renderJobsRoute(
      renderRequest({
        operationType: "image_generation",
        approvalRequestId: approval.id,
        prompt: "Generate one approved image creative.",
        input: {
          aspectRatio: "4:5"
        }
      })
    );
    const body = await response.json();
    const storedApproval = await repository.getApproval(renderRequest({}), executor, approval.id);
    const storedJob = await repository.getJob(renderRequest({}), executor, body.job.id);
    const usage = await repository.listCostUsage(renderRequest({}), executor);

    expect(response.status).toBe(201);
    expect(body.job).toMatchObject({
      tenantId: executor.tenantId,
      createdBy: "00000000-0000-0000-0000-000000000010",
      type: "image_generation",
      status: "queued",
      input: {
        operation: "ai_paid_generation",
        operationType: "image_generation",
        approvalRequestId: approval.id,
        prompt: "Generate one approved image creative.",
        requestedInput: {
          aspectRatio: "4:5"
        },
        costUsageRelatedJobId: approval.id,
        cost: {
          provider: "mock-ai",
          model: "mock-generation",
          operationType: "image_generation",
          estimatedCredits: 5,
          estimatedCostKrw: 500,
          relatedJobId: approval.id
        }
      }
    });
    expect(body.approval).toMatchObject({
      id: approval.id,
      status: "executed",
      executionResultJson: {
        operation: "ai_paid_generation",
        operationType: "image_generation",
        result: "paid_generation_job_queued",
        jobId: body.job.id
      }
    });
    expect(storedApproval?.status).toBe("executed");
    expect(storedJob).toMatchObject(body.job);
    expect(usage.at(-1)).toMatchObject({
      tenantId: executor.tenantId,
      operationType: "image_generation",
      estimatedCostKrw: 500,
      relatedJobId: approval.id,
      status: "running"
    });
    expect(JSON.stringify(body)).not.toContain("daily_budget");
  });

  it("does not allow a paid generation approval to queue multiple jobs", async () => {
    clearEnv();
    const executor = useMockTenant("00000000-0000-0000-0000-000000000305");
    const repository = new MemoryHermesRepository();
    const approval = approvedPaidGenerationApproval("video_generation", executor.tenantId);
    await repository.saveApproval(renderRequest({}), approval);

    await renderJobsRoute(
      renderRequest({
        operationType: "video_generation",
        approvalRequestId: approval.id,
        prompt: "Generate one approved video creative."
      })
    );
    const secondResponse = await renderJobsRoute(
      renderRequest({
        operationType: "video_generation",
        approvalRequestId: approval.id,
        prompt: "Generate one approved video creative again."
      })
    );
    const secondBody = await secondResponse.json();

    expect(secondResponse.status).toBe(403);
    expect(secondBody.error.code).toBe("APPROVAL_REQUIRED");
  });
});
