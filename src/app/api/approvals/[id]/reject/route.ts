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
    if (!approval) return fail("APPROVAL_NOT_FOUND", "Approval request was not found.", 404);

    const rejected = rejectRequest(approval, context, body.reason);
    await repository.updateApproval(request, rejected);

    if (rejected.action === "tenant_data_deletion" && rejected.objectId) {
      const deletionRequest = await repository.getDataDeletionRequest(request, context, rejected.objectId);
      if (deletionRequest) {
        await repository.updateDataDeletionRequest(request, {
          ...deletionRequest,
          status: "cancelled",
          resultJson: {
            ...asRecord(deletionRequest.resultJson),
            approvalRequestId: rejected.id,
            approvalStatus: rejected.status,
            rejectedBy: context.userId,
            rejectionReason: typeof body.reason === "string" ? body.reason.trim() || undefined : undefined
          }
        });
      }
    }

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

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}
