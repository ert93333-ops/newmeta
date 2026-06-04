import { assertExecutableApproval, markExecuted } from "@/lib/approval/approval-policy";
import { planApprovalExecution } from "@/lib/approval/execution-policy";
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
    const execution = planApprovalExecution(approval.action);
    const executed = markExecuted(approval);
    await repository.updateApproval(request, executed);
    await repository.saveAuditLog(request, {
      tenantId: context.tenantId,
      userId: context.userId,
      action: `approval_executed:${executed.action}`,
      objectType: executed.objectType,
      objectId: executed.objectId,
      approvalRequestId: executed.id,
      beforeJson: approval,
      afterJson: executed,
      result: "executed"
    });
    return ok({
      approval: executed,
      execution: execution.result,
      executionMode: execution.mode
    });
  } catch (error) {
    return handleError(error);
  }
}
