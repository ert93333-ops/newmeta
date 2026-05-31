import { describe, expect, it } from "vitest";
import { classifyDataSufficiency, diagnoseBottlenecks } from "@/lib/bottleneck/diagnosis";
import type { MetaInsight } from "@/lib/types";

const insight: MetaInsight = {
  spend: 42000,
  impressions: 3200,
  reach: 2500,
  frequency: 1.2,
  clicks: 90,
  linkClicks: 110,
  outboundClicks: 100,
  landingPageViews: 90,
  purchases: 4,
  addToCart: 12,
  ctr: 2.8,
  cpc: 380,
  cpm: 12000,
  purchaseRoas: 2.1
};

describe("bottleneck diagnosis", () => {
  it("classifies high confidence when enough data exists", () => {
    expect(classifyDataSufficiency(insight)).toBe("high_confidence");
  });

  it("covers all required funnel stages", () => {
    expect(diagnoseBottlenecks(insight).stages).toHaveLength(11);
  });
});
