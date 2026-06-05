import { handleError, ok } from "@/lib/api/responses";
import { resolveUserContext } from "@/lib/api/context";
import { resolveEffectiveDailyCap } from "@/lib/guards/cost-guard";
import { getRepository } from "@/lib/repositories/hermes-repository";
import { loadServerCostSettings, readCostProviderName } from "@/lib/settings/cost-settings";

export async function GET(request: Request) {
  try {
    const context = await resolveUserContext(request);
    const repository = getRepository();
    const providerName = readCostProviderName(new URL(request.url).searchParams.get("providerName"));
    const settings = await loadServerCostSettings(request, context, repository, providerName);
    const summary = await repository.summarizeCostUsage(request, context);
    return ok({
      usage: await repository.listCostUsage(request, context),
      summary,
      policy: {
        providerName,
        planName: settings.planName,
        dailyCostCapKrw: settings.dailyCostCapKrw,
        hardDailyCapKrw: settings.hardDailyCapKrw,
        monthlyCostCapKrw: settings.monthlyCostCapKrw,
        referenceDailyAdBudgetKrw: settings.referenceDailyAdBudgetKrw,
        effectiveDailyCapKrw: resolveEffectiveDailyCap(settings),
        budgetMutation: "hard_blocked"
      }
    });
  } catch (error) {
    return handleError(error);
  }
}
