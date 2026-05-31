import type { CostEstimateInput, CostSettings } from "@/lib/types";

export type CostGuardDecision =
  | {
      status: "allowed";
      estimatedCostKrw: number;
      effectiveDailyCapKrw: number;
      message: string;
      requiresApproval: false;
    }
  | {
      status: "approval_required";
      estimatedCostKrw: number;
      effectiveDailyCapKrw: number;
      message: string;
      requiresApproval: true;
    }
  | {
      status: "blocked";
      estimatedCostKrw: number;
      effectiveDailyCapKrw: number;
      message: string;
      requiresApproval: false;
    };

const DEFAULT_REFERENCE_DAILY_AD_BUDGET_KRW = 50000;
const DEFAULT_DAILY_CAP_KRW = 5000;
const DEFAULT_HARD_CAP_KRW = 7500;

export function resolveEffectiveDailyCap(settings: CostSettings): number {
  const referenceBudget = settings.referenceDailyAdBudgetKrw ?? DEFAULT_REFERENCE_DAILY_AD_BUDGET_KRW;
  const budgetRatioCap = Math.floor(referenceBudget * 0.1);
  const userCap = settings.dailyCostCapKrw ?? DEFAULT_DAILY_CAP_KRW;
  const hardCap = settings.hardDailyCapKrw ?? DEFAULT_HARD_CAP_KRW;
  return Math.min(userCap, hardCap, budgetRatioCap);
}

export function estimateOperationCostKrw(input: CostEstimateInput): number {
  const units = input.units ?? 1;
  const creditUnitCost = input.settings.creditUnitCostKrw ?? deriveCreditUnitCost(input.settings);
  const credits =
    input.estimatedCredits ??
    defaultCreditsForOperation(input.operationType, input.settings) * units;
  return Math.ceil(credits * creditUnitCost);
}

export function guardCost(input: CostEstimateInput): CostGuardDecision {
  const estimatedCostKrw = estimateOperationCostKrw(input);
  const effectiveDailyCapKrw = resolveEffectiveDailyCap(input.settings);
  const todayAfter = (input.todayActualCostKrw ?? 0) + estimatedCostKrw;
  const monthAfter = (input.monthActualCostKrw ?? 0) + estimatedCostKrw;
  const monthlyCap = input.settings.monthlyCostCapKrw;

  if (todayAfter > effectiveDailyCapKrw || (monthlyCap !== undefined && monthAfter > monthlyCap)) {
    return {
      status: "blocked",
      estimatedCostKrw,
      effectiveDailyCapKrw,
      message: "현재 생성 비용이 설정한 일 한도를 초과할 수 있어 자동 실행을 중단했습니다.",
      requiresApproval: false
    };
  }

  if (requiresPaidApproval(input.operationType)) {
    return {
      status: "approval_required",
      estimatedCostKrw,
      effectiveDailyCapKrw,
      message: approvalMessage(input.operationType),
      requiresApproval: true
    };
  }

  return {
    status: "allowed",
    estimatedCostKrw,
    effectiveDailyCapKrw,
    message: estimatedCostKrw === 0 ? "캐시 또는 저비용 검사를 사용합니다." : "설정한 비용 한도 내에서 실행할 수 있습니다.",
    requiresApproval: false
  };
}

function deriveCreditUnitCost(settings: CostSettings): number {
  if (settings.monthlyPlanPriceKrw && settings.monthlyCredits && settings.monthlyCredits > 0) {
    return settings.monthlyPlanPriceKrw / settings.monthlyCredits;
  }
  return 1;
}

function defaultCreditsForOperation(operationType: CostEstimateInput["operationType"], settings: CostSettings): number {
  switch (operationType) {
    case "cached_analysis":
    case "ocr_safezone_check":
      return 0;
    case "image_analysis":
      return settings.analysisCreditCost ?? 1;
    case "image_generation":
      return settings.imageGenerationCreditCost ?? 5;
    case "video_analysis":
      return settings.analysisCreditCost ?? 3;
    case "video_generation":
      return settings.videoGenerationCreditCost ?? 30;
    case "variant_batch":
      return settings.imageGenerationCreditCost ?? 5;
  }
}

function requiresPaidApproval(operationType: CostEstimateInput["operationType"]): boolean {
  return operationType === "image_generation" || operationType === "video_generation" || operationType === "variant_batch";
}

function approvalMessage(operationType: CostEstimateInput["operationType"]): string {
  if (operationType === "video_generation") {
    return "영상 생성은 비용이 높아 승인 후 실행됩니다.";
  }
  if (operationType === "variant_batch") {
    return "여러 variant 생성은 비용이 발생할 수 있어 승인 후 실행됩니다.";
  }
  return "이미지 생성은 외부 AI 비용이 발생할 수 있어 승인 후 실행됩니다.";
}
