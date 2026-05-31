import type { CreativeManifest, Score } from "@/lib/types";
import { checkForbiddenFinalText, checkPriceAccuracy, checkSafeArea } from "@/lib/creative/checkers";
import { validatePlacement } from "@/lib/placement/placement-validator";
import { checkPolicyRisk } from "@/lib/policy/policy-risk-checker";

export interface ImageCreativeAnalysis {
  scores: Score[];
  checks: {
    safeArea: ReturnType<typeof checkSafeArea>;
    priceAccuracy: ReturnType<typeof checkPriceAccuracy>;
    forbiddenText: ReturnType<typeof checkForbiddenFinalText>;
    policyRisk: ReturnType<typeof checkPolicyRisk>;
  };
  placement?: ReturnType<typeof validatePlacement>;
  recommendations: string[];
}

export function analyzeImageCreative(manifest: CreativeManifest): ImageCreativeAnalysis {
  const safeArea = checkSafeArea(manifest);
  const priceAccuracy = checkPriceAccuracy(manifest);
  const forbiddenText = checkForbiddenFinalText(manifest.textBoxes);
  const policyRisk = checkPolicyRisk([
    ...manifest.textBoxes.map((box) => box.text),
    manifest.primaryText,
    manifest.headline,
    manifest.description
  ].filter(Boolean).join(" "));
  const placement = manifest.placements?.length
    ? validatePlacement({ asset: manifest.asset, placements: manifest.placements })
    : undefined;

  const hook = manifest.textBoxes.find((box) => box.role === "hook");
  const cta = manifest.textBoxes.find((box) => box.role === "cta");
  const price = manifest.textBoxes.find((box) => box.role === "price");

  const scores: Score[] = [
    score("Hook Score", hook ? 78 : 35, hook ? [`hook 문구: ${hook.text}`] : ["hook 문구를 찾지 못했습니다."]),
    score("Product Visibility Score", 70, ["초기 구현은 manifest 기반 제품 bbox 입력을 기다립니다."]),
    score("Layout Score", safeArea.passed ? 82 : 55, safeArea.passed ? ["주요 텍스트가 safe area 안에 있습니다."] : ["safe area 위반이 있습니다."]),
    score("Text Readability Score", forbiddenText.passed ? 78 : 25, forbiddenText.passed ? ["금지된 QA 문구가 없습니다."] : ["final 이미지에 QA 문구가 포함되었습니다."]),
    score("Offer Clarity Score", price ? 74 : 40, price ? [`가격 문구: ${price.text}`] : ["가격/오퍼 노출이 약합니다."]),
    score("CTA Strength Score", cta ? 72 : 38, cta ? [`CTA 문구: ${cta.text}`] : ["CTA 문구를 찾지 못했습니다."]),
    score("Design Consistency Score", 70, ["브랜드 토큰 입력 후 색상/폰트 일관성을 세분화합니다."]),
    score("Emotional Trigger Score", 62, ["감성 트리거는 텍스트/비주얼 태그 입력 후 강화됩니다."]),
    score("Placement Fit Score", placement ? placementScore(placement.status) : 60, placement ? placement.issues : ["placement가 지정되지 않았습니다."]),
    score("Safe Area Score", safeArea.passed ? 95 : 35, safeArea.violations.map((violation) => violation.text)),
    score("Policy Risk Score", policyRisk.status === "blocked" ? 10 : policyRisk.status === "needs_review" ? 45 : 85, policyRisk.findings)
  ];

  return {
    scores,
    checks: {
      safeArea,
      priceAccuracy,
      forbiddenText,
      policyRisk
    },
    placement,
    recommendations: buildRecommendations({ safeArea, priceAccuracy, forbiddenText, placement })
  };
}

function score(name: string, value: number, evidence: string[]): Score {
  return {
    name,
    value,
    evidence
  };
}

function placementScore(status: string): number {
  if (status === "compatible") return 90;
  if (status === "risky") return 62;
  if (status === "requires_variant") return 42;
  return 20;
}

function buildRecommendations(input: {
  safeArea: ReturnType<typeof checkSafeArea>;
  priceAccuracy: ReturnType<typeof checkPriceAccuracy>;
  forbiddenText: ReturnType<typeof checkForbiddenFinalText>;
  placement?: ReturnType<typeof validatePlacement>;
}): string[] {
  const recommendations: string[] = [];
  if (!input.safeArea.passed) {
    recommendations.push("텍스트와 가격 영역을 safe area 안으로 이동하세요.");
  }
  if (!input.priceAccuracy.passed) {
    recommendations.push(`가격은 지정값 ${input.priceAccuracy.expected}와 정확히 일치해야 합니다.`);
  }
  if (!input.forbiddenText.passed) {
    recommendations.push("final 이미지에서 safezone/px/가이드 문구를 제거하세요.");
  }
  if (input.placement?.status === "requires_variant") {
    recommendations.push(...input.placement.recommendations);
  }
  return recommendations;
}
