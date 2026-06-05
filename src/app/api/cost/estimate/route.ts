import { approvalGuardDetails, createApprovalRequest } from "@/lib/approval/approval-policy";
import { guardCost } from "@/lib/guards/cost-guard";
import { handleError, ok, parseWriteJson } from "@/lib/api/responses";
import type { CostEstimateInput } from "@/lib/types";
import { resolveUserContext } from "@/lib/api/context";
import { costUsageFromEstimate, getRepository } from "@/lib/repositories/hermes-repository";

interface CostEstimateRequest extends CostEstimateInput {
  approvalRequest?: {
    create?: unknown;
    objectId?: unknown;
    reason?: unknown;
  };
}

export async function POST(request: Request) {
  try {
    const context = await resolveUserContext(request);
    const input = (await parseWriteJson(request)) as CostEstimateRequest;
    const decision = guardCost(input);
    const repository = getRepository();
    await repository.saveCostUsage(request, costUsageFromEstimate(input, context, decision.estimatedCostKrw));

    if (decision.status !== "approval_required" || input.approvalRequest?.create !== true) {
      return ok(decision);
    }

    const approval = createApprovalRequest({
      context,
      action: "ai_paid_generation",
      objectType: input.operationType,
      objectId: readOptionalString(input.approvalRequest.objectId),
      afterJson: {
        operationType: input.operationType,
        units: input.units,
        model: input.model,
        estimatedCredits: input.estimatedCredits,
        estimatedCostKrw: decision.estimatedCostKrw,
        effectiveDailyCapKrw: decision.effectiveDailyCapKrw,
        providerName: input.settings.providerName,
        status: decision.status
      },
      reason: readOptionalString(input.approvalRequest.reason) ?? `Paid AI operation approval for ${input.operationType}.`
    });

    await repository.saveApproval(request, approval);
    await repository.saveAuditLog(request, {
      tenantId: context.tenantId,
      userId: context.userId,
      action: "approval_requested:ai_paid_generation",
      objectType: approval.objectType,
      objectId: approval.objectId,
      approvalRequestId: approval.id,
      afterJson: approval,
      result: "pending"
    });

    return ok({ ...decision, approval, guard: approvalGuardDetails(approval) }, 201);
  } catch (error) {
    return handleError(error);
  }
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
