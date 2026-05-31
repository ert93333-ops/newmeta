import { guardCost } from "@/lib/guards/cost-guard";
import { handleError, ok, parseJson } from "@/lib/api/responses";
import type { CostEstimateInput } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const input = (await parseJson(request)) as CostEstimateInput;
    return ok(guardCost(input));
  } catch (error) {
    return handleError(error);
  }
}
