import { approveRequest } from "@/lib/approval/approval-policy";
import { fail, handleError, ok } from "@/lib/api/responses";
import { getStore, mockContext } from "@/lib/api/store";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const store = getStore();
    const approval = store.approvals.get(id);
    if (!approval) return fail("APPROVAL_NOT_FOUND", "승인 요청을 찾을 수 없습니다.", 404);
    const approved = approveRequest(approval, { ...mockContext(), userId: "00000000-0000-0000-0000-000000000011", role: "owner" });
    store.approvals.set(approved.id, approved);
    return ok({ approval: approved });
  } catch (error) {
    return handleError(error);
  }
}
