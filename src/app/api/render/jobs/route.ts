import { randomUUID } from "node:crypto";
import { assertExecutableApproval, markExecuted } from "@/lib/approval/approval-policy";
import { isProductionRuntime, resolveUserContext } from "@/lib/api/context";
import { checkForbiddenFinalText, checkPriceAccuracy, checkSafeArea } from "@/lib/creative/checkers";
import { fail, handleError, ok, parseWriteJson } from "@/lib/api/responses";
import { assertPaidOperationApproval, PaidOperationApprovalRequiredError } from "@/lib/guards/cost-guard";
import {
  costUsageFromExecutedApproval,
  getRepository,
  type HermesRepository
} from "@/lib/repositories/hermes-repository";
import type { ApprovalRequest, CostEstimateInput, CreativeManifest, UserContext } from "@/lib/types";

type PaidGenerationOperationType = Extract<CostEstimateInput["operationType"], "image_generation" | "video_generation">;

interface RenderJobRequest extends Partial<CreativeManifest> {
  operationType?: unknown;
  approvalRequestId?: unknown;
  prompt?: unknown;
  input?: unknown;
}

export async function POST(request: Request) {
  try {
    const body = (await parseWriteJson(request)) as RenderJobRequest;
    const paidGenerationOperationType = readPaidGenerationOperationType(body.operationType);
    if (!isRenderPipelineConfigured(paidGenerationOperationType)) {
      return fail("RENDER_PIPELINE_NOT_CONFIGURED", "The production render pipeline is not configured.", 501);
    }
    const context = await resolveUserContext(request);
    const repository = getRepository();

    if (paidGenerationOperationType) {
      return await queuePaidGenerationJob(request, context, repository, body, paidGenerationOperationType);
    }

    const manifest = body as CreativeManifest;
    const checks = {
      safeArea: checkSafeArea(manifest),
      priceAccuracy: checkPriceAccuracy(manifest),
      forbiddenFinalText: checkForbiddenFinalText(manifest.textBoxes)
    };
    const job = {
      id: randomUUID(),
      tenantId: context.tenantId,
      createdBy: context.userId,
      type: "render",
      status: Object.values(checks).every((check) => check.passed) ? "succeeded" : "failed",
      result: {
        finalImage: "ready_without_guides",
        qaImage: "ready_with_safezone_overlay",
        checks
      }
    };
    await repository.saveJob(request, job);
    return ok(job, 201);
  } catch (error) {
    return handleError(error);
  }
}

async function queuePaidGenerationJob(
  request: Request,
  context: UserContext,
  repository: HermesRepository,
  body: RenderJobRequest,
  operationType: PaidGenerationOperationType
) {
  const approvalRequestId = readApprovalRequestId(body.approvalRequestId, operationType);
  const approval = await repository.getApproval(request, context, approvalRequestId);

  assertPaidOperationApproval(approval, operationType);
  assertExecutableApproval(approval, context);

  const jobId = randomUUID();
  const executed = markExecuted(approval, {
    operation: "ai_paid_generation",
    operationType,
    result: "paid_generation_job_queued",
    externalStatus: "QUEUED",
    jobId
  });
  const persisted = await repository.updateApproval(request, executed);
  const runningCostUsage = runningCostUsageFromApproval(persisted, context);
  await repository.saveCostUsage(request, runningCostUsage);

  const job = {
    id: jobId,
    tenantId: context.tenantId,
    createdBy: context.userId,
    type: operationType,
    status: "queued",
    input: {
      operation: "ai_paid_generation",
      operationType,
      approvalRequestId: persisted.id,
      prompt: readOptionalString(body.prompt),
      requestedInput: body.input ?? {},
      costUsageRelatedJobId: persisted.id,
      cost: {
        provider: runningCostUsage.provider,
        model: runningCostUsage.model,
        operationType: runningCostUsage.operationType,
        estimatedCredits: runningCostUsage.estimatedCredits,
        estimatedCostKrw: runningCostUsage.estimatedCostKrw,
        relatedJobId: runningCostUsage.relatedJobId
      }
    }
  };
  await repository.saveJob(request, job);

  await repository.saveAuditLog(request, {
    tenantId: context.tenantId,
    userId: context.userId,
    action: `paid_generation_job_queued:${operationType}`,
    objectType: operationType,
    objectId: job.id,
    approvalRequestId: persisted.id,
    beforeJson: approval,
    afterJson: {
      approval: persisted,
      job
    },
    result: "queued"
  });

  return ok({ job, approval: persisted }, 201);
}

function readPaidGenerationOperationType(value: unknown): PaidGenerationOperationType | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "image_generation" || value === "video_generation") {
    return value;
  }
  throw new Error("UNSUPPORTED_RENDER_OPERATION_TYPE");
}

function readApprovalRequestId(value: unknown, operationType: PaidGenerationOperationType): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PaidOperationApprovalRequiredError(operationType);
  }
  return value.trim();
}

function runningCostUsageFromApproval(approval: ApprovalRequest, context: UserContext) {
  return {
    ...costUsageFromExecutedApproval(approval, context),
    actualCredits: undefined,
    actualCostKrw: undefined,
    status: "running"
  };
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function isRenderPipelineConfigured(
  paidGenerationOperationType: PaidGenerationOperationType | undefined
): boolean {
  if (paidGenerationOperationType) {
    return true;
  }
  return !isProductionRuntime() || process.env.HERMES_RENDER_PIPELINE_MODE === "live";
}
