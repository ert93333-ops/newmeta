import { describe, expect, it } from "vitest";
import { fuseCreativeAndPerformance } from "@/lib/performance/fusion";

describe("performance fusion", () => {
  it("uses hypothesis language instead of causal certainty", () => {
    const report = fuseCreativeAndPerformance({
      creativeScores: [{ name: "Hook Score", value: 40, evidence: ["weak hook"] }],
      diagnosis: {
        dataSufficiency: "actionable_signal",
        hypotheses: [],
        stages: [
          {
            stage: "Hook/Attention",
            score: 40,
            confidence: "actionable_signal",
            evidence: ["CTR 0.6%"],
            recommendation: "test hook"
          }
        ]
      }
    });
    expect(JSON.stringify(report)).toContain("가능성");
    expect(JSON.stringify(report)).not.toContain("원인입니다");
  });
});
