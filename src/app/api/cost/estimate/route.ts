import { guardCost } from "@/lib/guards/cost-guard";
import { handleError, ok, parseJson } from "@/lib/api/responses";
import type { CostEstimateInput } from "@/lib/types";
import { resolveUserContext } from "@/lib/api/context";
import { costUsageFromEstimate, getRepository } from "@/lib/repositories/hermes-repository";

export async function POST(request: Request) {
  try {
    const context = await resolveUserContext(request);
    const input = (await parseJson(request)) as CostEstimateInput;
    const decision = guardCost(input);
    await getRepository().saveCostUsage(request, costUsageFromEstimate(input, context, decision.estimatedCostKrw));
    return ok(decision);
  } catch (error) {
    return handleError(error);
  }
}
