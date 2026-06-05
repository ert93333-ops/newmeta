import { runDraftPreflight } from "@/lib/drafts/preflight";
import { handleError, ok, parseWriteJson } from "@/lib/api/responses";
import { resolveUserContext } from "@/lib/api/context";
import type { DraftPreflightInput } from "@/lib/drafts/preflight";

export async function POST(request: Request) {
  try {
    await resolveUserContext(request);
    return ok(runDraftPreflight((await parseWriteJson(request)) as DraftPreflightInput));
  } catch (error) {
    return handleError(error);
  }
}
