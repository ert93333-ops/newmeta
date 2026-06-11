import { assertExecutableApproval, markExecuted } from "@/lib/approval/approval-policy";
import {
  configuredApprovalExecutionMode,
  executeApprovedAction,
  isApprovalActionDomainExecutorRequiredError
} from "@/lib/approval/execution-policy";
import { executeLiveApprovedAction, supportsLiveApprovalExecution } from "@/lib/approval/live-execution";
import { resolveUserContext } from "@/lib/api/context";
import { fail, handleError, ok, parseWriteJson } from "@/lib/api/responses";
import type { ApprovalExecutionResult } from "@/lib/approval/execution-policy";
import { getRepository } from "@/lib/repositories/hermes-repository";
import type { HermesRepository } from "@/lib/repositories/hermes-repository";
import type { ApprovalRequest, UserContext } from "@/lib/types";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await parseWriteJson(request);
    const context = await resolveUserContext(request);
    const repository = getRepository();
    const approval = await repository.getApproval(request, context, id);
    if (!approval) return fail("APPROVAL_NOT_FOUND", "Approval request was not found.", 404);

    assertExecutableApproval(approval, context);

    let execution: ApprovalExecutionResult;
    try {
      execution =
        approval.action === "meta_disconnect_connection"
          ? await executeMetaDisconnectApproval(request, context, approval, repository)
          : configuredApprovalExecutionMode() === "live" && supportsLiveApprovalExecution(approval.action)
            ? await executeLiveApprovedAction(request, context, approval, repository)
          : executeApprovedAction(approval);
    } catch (error) {
      if (isApprovalActionDomainExecutorRequiredError(error)) {
        await syncBlockedDataDeletionExecutionAttempt(request, context, approval, repository, error);
      }
      throw error;
    }

    const executed = markExecuted(approval, execution);
    const persisted = await repository.updateApproval(request, executed);
    await repository.saveAuditLog(request, {
      tenantId: context.tenantId,
      userId: context.userId,
      action: `approval_executed:${persisted.action}`,
      objectType: persisted.objectType,
      objectId: persisted.objectId,
      approvalRequestId: persisted.id,
      beforeJson: approval,
      afterJson: persisted,
      result: execution.result
    });
    return ok({
      approval: persisted,
      execution: execution.result,
      executionMode: execution.mode,
      executionDetails: execution
    });
  } catch (error) {
    return handleError(error);
  }
}

async function executeMetaDisconnectApproval(
  request: Request,
  context: UserContext,
  approval: ApprovalRequest,
  repository: HermesRepository
): Promise<ApprovalExecutionResult> {
  const connectionId = approval.objectId ?? approval.id;
  const disconnected = await repository.disconnectMetaConnection(request, context, connectionId, context.userId);
  if (!disconnected) {
    throw new Error("META_CONNECTION_NOT_FOUND");
  }

  return {
    mode: disconnected.mode,
    result: disconnected.mode === "mock" ? "mock_disconnected_meta_connection" : "meta_connection_disconnected",
    operation: approval.action,
    externalObjectId: disconnected.connection.id,
    externalStatus: "DELETED",
    details: {
      approvalId: approval.id,
      tenantId: approval.tenantId,
      previousStatus: disconnected.previousStatus,
      disconnectedStatus: disconnected.connection.status,
      tokenMaterialCleared: disconnected.tokenMaterialCleared,
      mockSafe: disconnected.mode === "mock"
    }
  };
}

async function syncBlockedDataDeletionExecutionAttempt(
  request: Request,
  context: UserContext,
  approval: ApprovalRequest,
  repository: HermesRepository,
  error: { code: string; route: string }
): Promise<void> {
  if (approval.action !== "tenant_data_deletion" || !approval.objectId) {
    return;
  }

  const deletionRequest = await repository.getDataDeletionRequest(request, context, approval.objectId);
  if (!deletionRequest) {
    return;
  }

  const updatedDeletionRequest = await repository.updateDataDeletionRequest(request, {
    ...deletionRequest,
    resultJson: {
      ...asRecord(deletionRequest.resultJson),
      approvalRequestId: approval.id,
      approvalStatus: approval.status,
      secondApprovedBy: approval.secondApprovedBy,
      readyForExecution: approval.requiresSecondApproval ? Boolean(approval.secondApprovedBy) : approval.status === "approved",
      blockedReason: error.code,
      requiredRoute: error.route,
      lastExecutionAttemptBy: context.userId,
      lastExecutionAttemptAt: new Date().toISOString()
    }
  });

  await repository.saveAuditLog(request, {
    tenantId: context.tenantId,
    userId: context.userId,
    action: "approval_execute_blocked:tenant_data_deletion",
    objectType: "data_deletion_request",
    objectId: updatedDeletionRequest.id,
    approvalRequestId: approval.id,
    beforeJson: deletionRequest,
    afterJson: updatedDeletionRequest,
    result: error.code
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}
