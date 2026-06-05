import { assertExecutableApproval, markExecuted } from "@/lib/approval/approval-policy";
import { executeApprovedAction } from "@/lib/approval/execution-policy";
import { resolveUserContext } from "@/lib/api/context";
import { fail, handleError, ok, parseWriteJson } from "@/lib/api/responses";
import type { HermesRepository } from "@/lib/repositories/hermes-repository";
import { getRepository } from "@/lib/repositories/hermes-repository";
import type { ApprovalExecutionResult } from "@/lib/approval/execution-policy";
import type { ApprovalRequest, UserContext } from "@/lib/types";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await parseWriteJson(request);
    const context = await resolveUserContext(request);
    const repository = getRepository();
    const approval = await repository.getApproval(request, context, id);
    if (!approval) return fail("APPROVAL_NOT_FOUND", "?뱀씤 ?붿껌??李얠쓣 ???놁뒿?덈떎.", 404);
    assertExecutableApproval(approval, context);
    const execution =
      approval.action === "meta_disconnect_connection"
        ? await executeMetaDisconnectApproval(request, context, approval, repository)
        : executeApprovedAction(approval);
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
