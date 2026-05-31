import { runDraftPreflight } from "@/lib/drafts/preflight";
import { handleError, ok, parseJson } from "@/lib/api/responses";
import type { DraftPreflightInput } from "@/lib/drafts/preflight";

export async function POST(request: Request) {
  try {
    return ok(runDraftPreflight((await parseJson(request)) as DraftPreflightInput));
  } catch (error) {
    return handleError(error);
  }
}
