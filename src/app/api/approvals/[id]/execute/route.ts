import { assertExecutableApproval, markExecuted } from "@/lib/approval/approval-policy";
import { executeApprovedAction } from "@/lib/approval/execution-policy";
import { fail, handleError, ok, parseWriteJson } from "@/lib/api/responses";
import { resolveUserContext } from "@/lib/api/context";
import { getRepository } from "@/lib/repositories/hermes-repository";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await parseWriteJson(request);
    const context = await resolveUserContext(request);
    const repository = getRepository();
    const approval = await repository.getApproval(request, context, id);
    if (!approval) return fail("APPROVAL_NOT_FOUND", "승인 요청을 찾을 수 없습니다.", 404);
    assertExecutableApproval(approval, context);
    const execution = executeApprovedAction(approval);
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
