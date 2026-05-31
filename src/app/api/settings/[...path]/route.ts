import { assertNoBudgetMutation } from "@/lib/guards/budget-guard";
import { fail, handleError, ok, parseJson } from "@/lib/api/responses";

export async function PATCH(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  try {
    const { path } = await params;
    const body = await parseJson(request);
    if (path.includes("budget")) {
      return fail("BUDGET_MUTATION_HARD_BLOCKED", "예산 자동 변경 설정은 제공하지 않습니다.", 403);
    }
    assertNoBudgetMutation(body);
    return ok({
      status: "accepted",
      path,
      note: "Settings persistence is backed by integration_settings in Supabase."
    });
  } catch (error) {
    return handleError(error);
  }
}
