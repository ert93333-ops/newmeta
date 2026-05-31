import { describe, expect, it } from "vitest";
import { assertNoBudgetMutation, findBudgetMutationPaths } from "@/lib/guards/budget-guard";

describe("budget guard", () => {
  it("hard-blocks budget mutation keys", () => {
    expect(() =>
      assertNoBudgetMutation({
        creative: { title: "ok" },
        daily_budget: 50000
      })
    ).toThrow("예산 자동 변경");
  });

  it("allows recommendation language without executable budget fields", () => {
    expect(() =>
      assertNoBudgetMutation({
        recommendation: "예산 증액을 검토하세요. 시스템은 실행하지 않습니다."
      })
    ).not.toThrow();
  });

  it("reports nested paths", () => {
    expect(findBudgetMutationPaths({ adset: { bidAmount: 1000 } })).toEqual(["$.adset.bidAmount"]);
  });
});
