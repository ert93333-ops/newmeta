import { handleError, fail, ok } from "@/lib/api/responses";
import { resolveUserContext } from "@/lib/api/context";
import { loadAutopilotRecommendations } from "@/lib/operations/autopilot-recommendations";
import { createSupabaseClient, getBearerAuthorization } from "@/lib/supabase/server";

export async function GET(request: Request) {
  try {
    const context = await resolveUserContext(request);
    const supabase = createSupabaseClient("user", getBearerAuthorization(request));
    if (!supabase) {
      return fail("SUPABASE_REQUIRED", "Supabase is required for autopilot recommendations.", 500);
    }

    return ok(await loadAutopilotRecommendations(supabase, context.tenantId));
  } catch (error) {
    return handleError(error);
  }
}
