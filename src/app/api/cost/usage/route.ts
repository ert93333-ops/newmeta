import { ok } from "@/lib/api/responses";
import { getStore } from "@/lib/api/store";

export function GET() {
  return ok({
    usage: getStore().costUsage,
    policy: {
      defaultDailyCapKrw: 5000,
      hardDailyCapKrw: 7500,
      budgetMutation: "hard_blocked"
    }
  });
}
