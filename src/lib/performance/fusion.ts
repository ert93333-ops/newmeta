import type { BottleneckDiagnosis } from "@/lib/bottleneck/diagnosis";
import type { Score } from "@/lib/types";

export interface FusionHypothesis {
  observedCreativeElement: string;
  relatedMetric: string;
  possibleCause: string;
  confidence: "low" | "medium" | "high";
  recommendation: string;
  abTestDesign: string;
}

export interface PerformanceFusionReport {
  hypotheses: FusionHypothesis[];
  languageGuard: "correlation_not_causation";
}

export function fuseCreativeAndPerformance(input: {
  creativeScores: Score[];
  diagnosis: BottleneckDiagnosis;
}): PerformanceFusionReport {
  const hypotheses: FusionHypothesis[] = [];
  const scoreMap = new Map(input.creativeScores.map((score) => [score.name, score]));

  const hook = scoreMap.get("Hook Score");
  const hookStage = input.diagnosis.stages.find((stage) => stage.stage === "Hook/Attention");
  if (hook && hookStage && hook.value < 60 && hookStage.score < 60) {
    hypotheses.push({
      observedCreativeElement: "Hook score 낮음",
      relatedMetric: hookStage.evidence.join(", "),
      possibleCause: "초반 주목을 충분히 만들지 못했을 가능성이 높습니다.",
      confidence: confidenceFromStage(hookStage.confidence),
      recommendation: "첫 문장을 혜택형 또는 문제제기형 hook으로 교체하세요.",
      abTestDesign: "control 대비 hook 문구만 변경하고 CTR과 first 3s retention을 비교합니다."
    });
  }

  const product = scoreMap.get("Product Visibility Score");
  const clarityStage = input.diagnosis.stages.find((stage) => stage.stage === "Product Clarity");
  if (product && clarityStage && product.value < 65 && clarityStage.score < 65) {
    hypotheses.push({
      observedCreativeElement: "Product visibility 낮음",
      relatedMetric: clarityStage.evidence.join(", "),
      possibleCause: "제품 인지가 늦거나 약해 클릭 의도가 약해졌을 가능성이 있습니다.",
      confidence: confidenceFromStage(clarityStage.confidence),
      recommendation: "제품 bbox 면적과 중심 위치를 키운 variant를 만드세요.",
      abTestDesign: "제품 크기만 변경하고 link CTR과 outbound click rate를 비교합니다."
    });
  }

  const offer = scoreMap.get("Offer Clarity Score");
  const offerStage = input.diagnosis.stages.find((stage) => stage.stage === "Product Page/Offer");
  if (offer && offerStage && offer.value < 60 && offerStage.score < 60) {
    hypotheses.push({
      observedCreativeElement: "Offer clarity 낮음",
      relatedMetric: offerStage.evidence.join(", "),
      possibleCause: "가격/혜택 이해가 약해 전환 설득이 부족했을 가능성이 있습니다.",
      confidence: confidenceFromStage(offerStage.confidence),
      recommendation: "가격과 CTA를 가깝게 배치하되 가격 정확도를 유지하세요.",
      abTestDesign: "가격 위치만 변경하고 CVR, ATC rate, purchase rate를 비교합니다."
    });
  }

  return {
    hypotheses,
    languageGuard: "correlation_not_causation"
  };
}

function confidenceFromStage(confidence: BottleneckDiagnosis["dataSufficiency"]): FusionHypothesis["confidence"] {
  if (confidence === "high_confidence") return "high";
  if (confidence === "actionable_signal") return "medium";
  return "low";
}
