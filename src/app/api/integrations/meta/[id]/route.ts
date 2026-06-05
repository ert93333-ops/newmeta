import { approvalGuardDetails, createApprovalRequest } from "@/lib/approval/approval-policy";
import { resolveUserContext } from "@/lib/api/context";
import { handleError, ok, parseWriteJson } from "@/lib/api/responses";
import { getRepository } from "@/lib/repositories/hermes-repository";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await resolveUserContext(request);
    await parseWriteJson(request);
    const { id } = await params;
    const repository = getRepository();
    const approval = createApprovalRequest({
      context,
      action: "meta_disconnect_connection",
      objectType: "meta_connection",
      objectId: id,
      beforeJson: {
        connectionId: id,
        status: "connected_or_unknown"
      },
      afterJson: {
        status: "disconnect_requested",
        cleanup: ["token_cleanup", "integration_cache_cleanup", "audit_log_entry"]
      },
      reason: "Disconnect Meta connection and queue tenant-scoped integration cleanup."
    });

    await repository.saveApproval(request, approval);
    await repository.saveAuditLog(request, {
      tenantId: context.tenantId,
      userId: context.userId,
      action: "approval_requested:meta_disconnect_connection",
      objectType: "meta_connection",
      objectId: id,
      approvalRequestId: approval.id,
      afterJson: approval,
      result: "approval_required"
    });

    return ok(
      {
        id,
        status: "approval_required",
        requiredAction: "meta_disconnect_connection",
        approval,
        guard: approvalGuardDetails(approval)
      },
      202
    );
  } catch (error) {
    return handleError(error);
  }
}
