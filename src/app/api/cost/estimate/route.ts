import { approvalGuardDetails, createApprovalRequest } from "@/lib/approval/approval-policy";
import { estimateOperationCredits, guardCost } from "@/lib/guards/cost-guard";
import { handleError, ok, parseWriteJson } from "@/lib/api/responses";
import type { CostEstimateInput } from "@/lib/types";
import { resolveUserContext } from "@/lib/api/context";
import { costUsageFromEstimate, getRepository } from "@/lib/repositories/hermes-repository";
import { loadServerCostSettings, readCostProviderName } from "@/lib/settings/cost-settings";

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
    const repository = getRepository();
    const providerName = readCostProviderName(input.settings?.providerName);
    const settings = await loadServerCostSettings(request, context, repository, providerName);
    const usageSummary = await repository.summarizeCostUsage(request, context);
    const guardedInput = {
      operationType: input.operationType,
      units: input.units,
      model: input.model,
      estimatedCredits: estimateOperationCredits({
        operationType: input.operationType,
        units: input.units,
        model: input.model,
        settings
      }),
      settings,
      todayActualCostKrw: usageSummary.todayActualCostKrw,
      monthActualCostKrw: usageSummary.monthActualCostKrw
    };
    const decision = guardCost(guardedInput);

    if (decision.status !== "approval_required" || input.approvalRequest?.create !== true) {
      await repository.saveCostUsage(request, costUsageFromEstimate(guardedInput, context, decision.estimatedCostKrw));
      return ok({ ...decision, usageSummary });
    }

    const approval = createApprovalRequest({
      context,
      action: "ai_paid_generation",
      objectType: input.operationType,
      objectId: readOptionalString(input.approvalRequest.objectId),
      afterJson: {
        operationType: input.operationType,
        units: input.units,
        model: guardedInput.model,
        estimatedCredits: guardedInput.estimatedCredits,
        estimatedCostKrw: decision.estimatedCostKrw,
        effectiveDailyCapKrw: decision.effectiveDailyCapKrw,
        providerName: guardedInput.settings.providerName,
        status: decision.status,
        usageSummary
      },
      reason: readOptionalString(input.approvalRequest.reason) ?? `Paid AI operation approval for ${input.operationType}.`
    });

    await repository.saveApproval(request, approval);
    await repository.saveCostUsage(
      request,
      costUsageFromEstimate(guardedInput, context, decision.estimatedCostKrw, approval.id)
    );
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

    return ok({ ...decision, usageSummary, approval, guard: approvalGuardDetails(approval) }, 201);
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
