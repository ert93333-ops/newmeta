import { mockContext } from "@/lib/api/store";
import { ok } from "@/lib/api/responses";

export function GET() {
  return ok({
    user: mockContext(),
    permissions: {
      budgetMutation: "hard_blocked",
      dangerousActions: "approval_required"
    }
  });
}
