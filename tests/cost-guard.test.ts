import { describe, expect, it } from "vitest";
import { guardCost, resolveEffectiveDailyCap } from "@/lib/guards/cost-guard";

describe("cost guard", () => {
  it("uses the lower of user cap, hard cap, and 10 percent of ad budget", () => {
    expect(
      resolveEffectiveDailyCap({
        providerName: "higgsfield",
        dailyCostCapKrw: 10000,
        hardDailyCapKrw: 7500,
        referenceDailyAdBudgetKrw: 50000
      })
    ).toBe(5000);
  });

  it("requires approval for paid image generation", () => {
    const decision = guardCost({
      operationType: "image_generation",
      settings: {
        providerName: "higgsfield",
        creditUnitCostKrw: 100,
        imageGenerationCreditCost: 5
      }
    });
    expect(decision.status).toBe("approval_required");
  });

  it("blocks over-cap generation", () => {
    const decision = guardCost({
      operationType: "video_generation",
      todayActualCostKrw: 4900,
      settings: {
        providerName: "higgsfield",
        creditUnitCostKrw: 100,
        videoGenerationCreditCost: 30,
        referenceDailyAdBudgetKrw: 50000
      }
    });
    expect(decision.status).toBe("blocked");
  });
});
