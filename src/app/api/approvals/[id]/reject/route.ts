import { rejectRequest } from "@/lib/approval/approval-policy";
import { fail, handleError, ok, parseWriteJson } from "@/lib/api/responses";
import { resolveUserContext } from "@/lib/api/context";
import { getRepository } from "@/lib/repositories/hermes-repository";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const context = await resolveUserContext(request);
    const body = (await parseWriteJson(request)) as { reason?: string };
    const repository = getRepository();
    const approval = await repository.getApproval(request, context, id);
    if (!approval) return fail("APPROVAL_NOT_FOUND", "승인 요청을 찾을 수 없습니다.", 404);
    const rejected = rejectRequest(approval, context, body.reason);
    await repository.updateApproval(request, rejected);
    await repository.saveAuditLog(request, {
      tenantId: context.tenantId,
      userId: context.userId,
      action: `approval_rejected:${rejected.action}`,
      objectType: rejected.objectType,
      objectId: rejected.objectId,
      approvalRequestId: rejected.id,
      beforeJson: approval,
      afterJson: rejected,
      result: "rejected"
    });
    return ok({ approval: rejected });
  } catch (error) {
    return handleError(error);
  }
}
