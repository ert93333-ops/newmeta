import { assertNoBudgetMutation } from "@/lib/guards/budget-guard";
import { handleError, ok, parseJson } from "@/lib/api/responses";

export async function POST(request: Request) {
  try {
    const body = await parseJson(request);
    assertNoBudgetMutation(body);
    return ok(
      {
        status: "approval_required",
        message: "PAUSED 광고 생성도 승인 요청을 먼저 생성해야 합니다.",
        requiredAction: "meta_create_ad_paused"
      },
      202
    );
  } catch (error) {
    return handleError(error);
  }
}
