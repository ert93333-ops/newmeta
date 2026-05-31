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

export interface BottleneckDiagnosis {
  dataSufficiency: DataSufficiency;
  stages: BottleneckStageScore[];
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

  return {
    dataSufficiency: confidence,
    stages: [
      stage("Tracking/Data Quality", insight.landingPageViews > insight.linkClicks ? 40 : 80, confidence, [`LPV ${insight.landingPageViews}, link clicks ${insight.linkClicks}`], "Pixel/CAPI/GA4 이벤트 중복과 누락을 확인하세요."),
      stage("Delivery", insight.impressions < 500 ? 45 : 75, confidence, [`impressions ${insight.impressions}, CPM ${insight.cpm}`], "표본 부족이면 확정 진단 대신 관찰 상태로 유지하세요."),
      stage("Hook/Attention", linkCtr < 1 ? 35 : 75, confidence, [`Link CTR ${linkCtr.toFixed(2)}%`], "첫 문구와 제품 첫 인지 구간을 테스트하세요."),
      stage("Product Clarity", insight.clicks > 0 && linkCtr < 1.2 ? 45 : 70, confidence, [`clicks ${insight.clicks}, link clicks ${insight.linkClicks}`], "제품 크기, 사용 장면, 가격 위치를 분리 테스트하세요."),
      stage("Click Intent", insight.outboundClicks < insight.linkClicks * 0.7 ? 45 : 72, confidence, [`outbound clicks ${insight.outboundClicks}`], "CTA 문구와 랜딩 기대값 일치를 확인하세요."),
      stage("Landing Arrival", lpvRate < 60 ? 35 : 78, confidence, [`LPV/link click ${lpvRate.toFixed(2)}%`], "랜딩 속도와 URL 리다이렉트, Pixel 이벤트를 점검하세요."),
      stage("Product Page/Offer", purchaseRate < 2 ? 45 : 72, confidence, [`Purchase/LPV ${purchaseRate.toFixed(2)}%`], "오퍼, 가격, 배송/리뷰 근거를 확인하세요."),
      stage("Checkout", insight.addToCart > 0 && insight.purchases / insight.addToCart < 0.25 ? 42 : 70, confidence, [`ATC ${insight.addToCart}, purchases ${insight.purchases}`], "결제 단계 이탈과 배송비 노출 시점을 점검하세요."),
      stage("Revenue/ROAS", roas < 1.5 ? 40 : 76, confidence, [`ROAS ${roas}`], "예산 변경은 실행하지 말고 소재/오퍼 실험으로 개선안을 제안하세요."),
      stage("Fatigue", insight.frequency > 3 && linkCtr < 1.2 ? 35 : 72, confidence, [`frequency ${insight.frequency}`], "frequency 상승과 CTR 하락이 함께 보이면 fresh variant를 테스트하세요."),
      stage("Placement Fit", insight.breakdowns?.platform_position ? 70 : 55, confidence, [`placement ${insight.breakdowns?.platform_position ?? "unknown"}`], "placement별 asset customization과 #1487569 preflight를 적용하세요.")
    ]
  };
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
