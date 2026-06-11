import { assertExecutableApproval, markExecuted } from "@/lib/approval/approval-policy";
import { isProductionRuntime, resolveUserContext } from "@/lib/api/context";
import { designVariants } from "@/lib/variants/variant-designer";
import { handleError, ok, parseWriteJson } from "@/lib/api/responses";
import { assertPaidOperationApproval, PaidOperationApprovalRequiredError } from "@/lib/guards/cost-guard";
import { costUsageFromExecutedApproval, getRepository } from "@/lib/repositories/hermes-repository";
import type { VariantDesignInput } from "@/lib/variants/variant-designer";

interface VariantDesignRequest extends VariantDesignInput {
  approvalRequestId?: unknown;
}

export async function POST(request: Request) {
  try {
    const body = (await parseWriteJson(request)) as VariantDesignRequest;
    if (isProductionRuntime()) {
      throw new Error("PAID_VARIANT_DESIGN_NOT_CONFIGURED");
    }
    const context = await resolveUserContext(request);
    const repository = getRepository();
    const approvalRequestId = readApprovalRequestId(body.approvalRequestId);
    const approval = await repository.getApproval(request, context, approvalRequestId);

    assertPaidOperationApproval(approval, "variant_batch");
    assertExecutableApproval(approval, context);

    const variantDesign = designVariants(body);
    const executed = markExecuted(approval, {
      operation: "ai_paid_generation",
      operationType: "variant_batch",
      result: "variant_design_created",
      externalStatus: "GENERATED",
      controlId: body.controlId,
      variantCount: variantDesign.variants.length
    });
    const persisted = await repository.updateApproval(request, executed);
    await repository.saveCostUsage(request, costUsageFromExecutedApproval(persisted, context));

    await repository.saveAuditLog(request, {
      tenantId: context.tenantId,
      userId: context.userId,
      action: "paid_operation_executed:variant_batch",
      objectType: "variant_batch",
      objectId: body.controlId,
      approvalRequestId: persisted.id,
      beforeJson: approval,
      afterJson: {
        approval: persisted,
        variantDesign
      },
      result: "variant_design_created"
    });

    return ok({ ...variantDesign, approval: persisted }, 201);
  } catch (error) {
    return handleError(error);
  }
}

function readApprovalRequestId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PaidOperationApprovalRequiredError("variant_batch");
  }
  return value.trim();
}
