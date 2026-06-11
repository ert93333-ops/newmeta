import { assertExecutableApproval, markExecuted } from "@/lib/approval/approval-policy";
import type { ApprovalExecutionResult } from "@/lib/approval/execution-policy";
import { resolveUserContext } from "@/lib/api/context";
import { fail, handleError, ok, parseWriteJson } from "@/lib/api/responses";
import { getRepository } from "@/lib/repositories/hermes-repository";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await parseWriteJson(request)) as { approvalRequestId?: unknown };
    const approvalRequestId = readRequiredString(body.approvalRequestId, "APPROVAL_REQUEST_ID_REQUIRED");
    const context = await resolveUserContext(request);
    const repository = getRepository();
    const deletionRequest = await repository.getDataDeletionRequest(request, context, id);
    if (!deletionRequest) {
      return fail("DATA_DELETION_REQUEST_NOT_FOUND", "Data deletion request was not found.", 404);
    }
    const deletionRequestId = deletionRequest.id ?? id;
    if (deletionRequest.status !== "approval_required") {
      return fail("DATA_DELETION_ALREADY_CLOSED", "Data deletion request is already closed.", 409, {
        status: deletionRequest.status
      });
    }

    const approval = await repository.getApproval(request, context, approvalRequestId);
    if (!approval || approval.action !== "tenant_data_deletion" || approval.objectId !== deletionRequestId) {
      return fail("APPROVAL_NOT_FOUND", "Matching data deletion approval request was not found.", 404);
    }
    assertExecutableApproval(approval, context);

    const runningDeletionRequest = await repository.updateDataDeletionRequest(request, {
      ...deletionRequest,
      status: "running",
      resultJson: {
        ...asRecord(deletionRequest.resultJson),
        approvalRequestId: approval.id,
        approvalStatus: approval.status,
        secondApprovedBy: approval.secondApprovedBy,
        startedAt: new Date().toISOString(),
        executedBy: context.userId
      }
    });
    const deletionResult = await repository.executeTenantDataDeletion(request, context, runningDeletionRequest);
    const execution: ApprovalExecutionResult = {
      mode: deletionResult.mode,
      result: deletionResult.mode === "mock" ? "mock_tenant_data_deleted" : "tenant_data_deleted",
      operation: approval.action,
      externalObjectId: deletionRequestId,
      externalStatus: "DELETED",
      details: {
        deletionRequestId,
        scope: deletionResult.scope,
        deletedCountsJson: JSON.stringify(deletionResult.deletedCounts)
      }
    };
    const executedApproval = await repository.updateApproval(request, markExecuted(approval, execution));
    const completedDeletionRequest = await repository.updateDataDeletionRequest(request, {
      ...runningDeletionRequest,
      status: "succeeded",
      resultJson: {
        ...asRecord(runningDeletionRequest.resultJson),
        approvalStatus: executedApproval.status,
        completedAt: new Date().toISOString(),
        result: execution.result,
        deletedCounts: deletionResult.deletedCounts
      }
    });

    await repository.saveAuditLog(request, {
      tenantId: context.tenantId,
      userId: context.userId,
      action: "data_deletion_executed",
      objectType: "data_deletion_request",
      objectId: completedDeletionRequest.id,
      approvalRequestId: approval.id,
      beforeJson: deletionRequest,
      afterJson: completedDeletionRequest,
      result: execution.result
    });

    return ok({
      deletionRequest: completedDeletionRequest,
      approval: executedApproval,
      execution
    });
  } catch (error) {
    return handleError(error);
  }
}

function readRequiredString(value: unknown, code: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(code);
  }
  return value.trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}
