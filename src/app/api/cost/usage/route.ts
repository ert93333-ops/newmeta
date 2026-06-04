import { handleError, ok } from "@/lib/api/responses";
import { resolveUserContext } from "@/lib/api/context";
import { getRepository } from "@/lib/repositories/hermes-repository";

export async function GET(request: Request) {
  try {
    const context = await resolveUserContext(request);
    return ok({
      usage: await getRepository().listCostUsage(request, context),
      policy: {
        defaultDailyCapKrw: 5000,
        hardDailyCapKrw: 7500,
        budgetMutation: "hard_blocked"
      }
    });
  } catch (error) {
    return handleError(error);
  }
}
