import { handleError, ok, parseJson } from "@/lib/api/responses";
import { validatePlacement } from "@/lib/placement/placement-validator";
import type { PlacementValidationInput } from "@/lib/placement/placement-validator";

export async function POST(request: Request) {
  try {
    const input = (await parseJson(request)) as PlacementValidationInput;
    return ok(validatePlacement(input));
  } catch (error) {
    return handleError(error);
  }
}
