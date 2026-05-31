import { rejectRequest } from "@/lib/approval/approval-policy";
import { fail, handleError, ok, parseJson } from "@/lib/api/responses";
import { getStore, mockContext } from "@/lib/api/store";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await parseJson(request)) as { reason?: string };
    const store = getStore();
    const approval = store.approvals.get(id);
    if (!approval) return fail("APPROVAL_NOT_FOUND", "승인 요청을 찾을 수 없습니다.", 404);
    const rejected = rejectRequest(approval, mockContext(), body.reason);
    store.approvals.set(rejected.id, rejected);
    return ok({ approval: rejected });
  } catch (error) {
    return handleError(error);
  }
}
