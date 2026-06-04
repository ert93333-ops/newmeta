import { handleError, ok } from "@/lib/api/responses";
import { resolveUserContext } from "@/lib/api/context";

export async function GET(request: Request) {
  try {
    return ok({
      user: await resolveUserContext(request),
      permissions: {
        budgetMutation: "hard_blocked",
        dangerousActions: "approval_required"
      }
    });
  } catch (error) {
    return handleError(error);
  }
}
