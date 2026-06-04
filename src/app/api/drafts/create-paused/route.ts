import { handleError, ok, parseWriteJson } from "@/lib/api/responses";

export async function POST(request: Request) {
  try {
    await parseWriteJson(request);
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
