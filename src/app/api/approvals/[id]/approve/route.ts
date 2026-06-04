import { approvalGuardDetails, approveRequest } from "@/lib/approval/approval-policy";
import { fail, handleError, ok, parseJson } from "@/lib/api/responses";
import { resolveUserContext } from "@/lib/api/context";
import { getRepository } from "@/lib/repositories/hermes-repository";
import { hasSupabaseConfig } from "@/lib/supabase/server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const context = await resolveUserContext(request);
    const body = (await parseJson(request)) as { typedConfirmation?: unknown; confirmationText?: unknown };
    const repository = getRepository();
    const approval = await repository.getApproval(request, context, id);
    if (!approval) return fail("APPROVAL_NOT_FOUND", "승인 요청을 찾을 수 없습니다.", 404);
    const actor =
      hasSupabaseConfig("user") && process.env.HERMES_AUTH_MODE !== "mock"
        ? context
        : { ...context, userId: "00000000-0000-0000-0000-000000000011", role: "owner" as const };
    const typedConfirmation =
      typeof body.typedConfirmation === "string"
        ? body.typedConfirmation
        : typeof body.confirmationText === "string"
          ? body.confirmationText
          : undefined;
    const approved = approveRequest(approval, actor, { typedConfirmation });
    await repository.updateApproval(request, approved);
    await repository.saveAuditLog(request, {
      tenantId: actor.tenantId,
      userId: actor.userId,
      action: `approval_approved:${approved.action}`,
      objectType: approved.objectType,
      objectId: approved.objectId,
      approvalRequestId: approved.id,
      beforeJson: approval,
      afterJson: approved,
      result: "approved"
    });
    return ok({ approval: approved, guard: approvalGuardDetails(approved) });
  } catch (error) {
    return handleError(error);
  }
}
