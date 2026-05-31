import { createApprovalRequest } from "@/lib/approval/approval-policy";
import { handleError, ok, parseJson } from "@/lib/api/responses";
import { getStore, mockContext } from "@/lib/api/store";

export async function POST(request: Request) {
  try {
    const body = (await parseJson(request)) as Omit<Parameters<typeof createApprovalRequest>[0], "context">;
    const approval = createApprovalRequest({
      ...body,
      context: mockContext()
    });
    getStore().approvals.set(approval.id, approval);
    return ok({ approval }, 201);
  } catch (error) {
    return handleError(error);
  }
}
