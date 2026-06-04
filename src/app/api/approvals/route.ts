import { createApprovalRequest } from "@/lib/approval/approval-policy";
import { handleError, ok, parseJson } from "@/lib/api/responses";
import { resolveUserContext } from "@/lib/api/context";
import { getRepository } from "@/lib/repositories/hermes-repository";

export async function POST(request: Request) {
  try {
    const context = await resolveUserContext(request);
    const body = (await parseJson(request)) as Omit<Parameters<typeof createApprovalRequest>[0], "context">;
    const approval = createApprovalRequest({
      ...body,
      context
    });
    const repository = getRepository();
    await repository.saveApproval(request, approval);
    await repository.saveAuditLog(request, {
      tenantId: context.tenantId,
      userId: context.userId,
      action: `approval_requested:${approval.action}`,
      objectType: approval.objectType,
      objectId: approval.objectId,
      approvalRequestId: approval.id,
      afterJson: approval,
      result: "pending"
    });
    return ok({ approval }, 201);
  } catch (error) {
    return handleError(error);
  }
}
