import { assertExecutableApproval, markExecuted } from "@/lib/approval/approval-policy";
import { fail, handleError, ok } from "@/lib/api/responses";
import { getStore, mockContext } from "@/lib/api/store";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const store = getStore();
    const approval = store.approvals.get(id);
    if (!approval) return fail("APPROVAL_NOT_FOUND", "승인 요청을 찾을 수 없습니다.", 404);
    assertExecutableApproval(approval, mockContext());
    const executed = markExecuted(approval);
    store.approvals.set(executed.id, executed);
    return ok({
      approval: executed,
      execution: "mock_executed_server_side"
    });
  } catch (error) {
    return handleError(error);
  }
}
