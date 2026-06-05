import type { MetaInsight } from "@/lib/types";

export type DataSufficiency = "observation" | "weak_signal" | "actionable_signal" | "high_confidence";

export interface BottleneckStageScore {
  stage:
    | "Tracking/Data Quality"
    | "Delivery"
    | "Hook/Attention"
    | "Product Clarity"
    | "Click Intent"
    | "Landing Arrival"
    | "Product Page/Offer"
    | "Checkout"
    | "Revenue/ROAS"
    | "Fatigue"
    | "Placement Fit";
  score: number;
  confidence: DataSufficiency;
  evidence: string[];
  recommendation: string;
}

export interface BottleneckHypothesis {
  hypothesis: string;
  confidence: DataSufficiency;
  evidence: string[];
}

export interface BottleneckDiagnosis {
  dataSufficiency: DataSufficiency;
  stages: BottleneckStageScore[];
  hypotheses: BottleneckHypothesis[];
}

export function classifyDataSufficiency(insight: MetaInsight): DataSufficiency {
  if (
    insight.impressions >= 3000 &&
    insight.linkClicks >= 100 &&
    insight.landingPageViews >= 80 &&
    insight.addToCart >= 10 &&
    insight.purchases >= 3
  ) {
    return "high_confidence";
  }
  if (
    insight.impressions >= 1500 &&
    insight.linkClicks >= 50 &&
    insight.landingPageViews >= 30 &&
    insight.addToCart >= 5 &&
    insight.purchases >= 2
  ) {
    return "actionable_signal";
  }
  if (insight.impressions >= 500 && insight.linkClicks >= 20 && insight.landingPageViews >= 15) {
    return "weak_signal";
  }
  return "observation";
}

export function diagnoseBottlenecks(insight: MetaInsight): BottleneckDiagnosis {
  const confidence = classifyDataSufficiency(insight);
  const linkCtr = safeRate(insight.linkClicks, insight.impressions) * 100;
  const lpvRate = safeRate(insight.landingPageViews, insight.linkClicks) * 100;
  const purchaseRate = safeRate(insight.purchases, insight.landingPageViews) * 100;
  const roas = insight.purchaseRoas ?? 0;
  const stages = [
    stage(
      "Tracking/Data Quality",
      insight.landingPageViews > insight.linkClicks ? 40 : 80,
      confidence,
      [`LPV ${insight.landingPageViews}, link clicks ${insight.linkClicks}`],
      "Pixel/CAPI/GA4 event quality should be rechecked."
    ),
    stage(
      "Delivery",
      insight.impressions < 500 ? 45 : 75,
      confidence,
      [`impressions ${insight.impressions}, CPM ${insight.cpm}`],
      "Stay in observation mode if delivery volume is still thin."
    ),
    stage(
      "Hook/Attention",
      linkCtr < 1 ? 35 : 75,
      confidence,
      [`Link CTR ${linkCtr.toFixed(2)}%`],
      "Test the opening hook and first product reveal."
    ),
    stage(
      "Product Clarity",
      insight.clicks > 0 && linkCtr < 1.2 ? 45 : 70,
      confidence,
      [`clicks ${insight.clicks}, link clicks ${insight.linkClicks}`],
      "Separate product scale, usage scene, and price visibility."
    ),
    stage(
      "Click Intent",
      insight.outboundClicks < insight.linkClicks * 0.7 ? 45 : 72,
      confidence,
      [`outbound clicks ${insight.outboundClicks}`],
      "Check CTA wording against landing-page promise alignment."
    ),
    stage(
      "Landing Arrival",
      lpvRate < 60 ? 35 : 78,
      confidence,
      [`LPV/link click ${lpvRate.toFixed(2)}%`],
      "Recheck landing speed, redirect behavior, and pixel arrival events."
    ),
    stage(
      "Product Page/Offer",
      purchaseRate < 2 ? 45 : 72,
      confidence,
      [`Purchase/LPV ${purchaseRate.toFixed(2)}%`],
      "Recheck offer clarity, pricing, shipping, and review proof."
    ),
    stage(
      "Checkout",
      insight.addToCart > 0 && insight.purchases / insight.addToCart < 0.25 ? 42 : 70,
      confidence,
      [`ATC ${insight.addToCart}, purchases ${insight.purchases}`],
      "Inspect checkout drop-off and late shipping-cost exposure."
    ),
    stage(
      "Revenue/ROAS",
      roas < 1.5 ? 40 : 76,
      confidence,
      [`ROAS ${roas}`],
      "Keep budget changes as recommendation only and improve creative or offer first."
    ),
    stage(
      "Fatigue",
      insight.frequency > 3 && linkCtr < 1.2 ? 35 : 72,
      confidence,
      [`frequency ${insight.frequency}`],
      "If frequency is high and CTR is falling, test fresh variants."
    ),
    stage(
      "Placement Fit",
      insight.breakdowns?.platform_position ? 70 : 55,
      confidence,
      [`placement ${insight.breakdowns?.platform_position ?? "unknown"}`],
      "Apply placement-specific asset variants and #1487569 preflight."
    )
  ];

  return {
    dataSufficiency: confidence,
    stages,
    hypotheses: deriveHypotheses(stages)
  };
}

function deriveHypotheses(stages: BottleneckStageScore[]): BottleneckHypothesis[] {
  return [...stages]
    .sort((left, right) => left.score - right.score)
    .filter((stage) => stage.score <= 50)
    .slice(0, 3)
    .map((stage) => ({
      hypothesis: `${stage.stage} is likely constraining performance.`,
      confidence: stage.confidence,
      evidence: stage.evidence
    }));
}

function stage(
  stageName: BottleneckStageScore["stage"],
  score: number,
  confidence: DataSufficiency,
  evidence: string[],
  recommendation: string
): BottleneckStageScore {
  return {
    stage: stageName,
    score,
    confidence,
    evidence,
    recommendation
  };
}

function safeRate(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }
  return numerator / denominator;
}
