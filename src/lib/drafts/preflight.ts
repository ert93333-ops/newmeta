import { assertNoBudgetMutation } from "@/lib/guards/budget-guard";
import { guardCost } from "@/lib/guards/cost-guard";
import { checkForbiddenFinalText, checkPriceAccuracy, checkSafeArea } from "@/lib/creative/checkers";
import { checkPolicyRisk } from "@/lib/policy/policy-risk-checker";
import { validatePlacement } from "@/lib/placement/placement-validator";
import type { CostEstimateInput, CreativeManifest } from "@/lib/types";

export interface DraftPreflightInput {
  manifest: CreativeManifest;
  pageId?: string;
  instagramActorId?: string;
  linkUrl?: string;
  cost?: CostEstimateInput;
  actionPayload?: unknown;
}

export interface DraftPreflightResult {
  status: "pass" | "approval_required" | "blocked";
  checks: Record<string, unknown>;
  approvalRequired: boolean;
  blockers: string[];
  warnings: string[];
}

export function runDraftPreflight(input: DraftPreflightInput): DraftPreflightResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  try {
    assertNoBudgetMutation(input.actionPayload ?? input);
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : "예산 변경 요청이 차단되었습니다.");
  }

  const safeArea = checkSafeArea(input.manifest);
  const priceAccuracy = checkPriceAccuracy(input.manifest);
  const forbiddenText = checkForbiddenFinalText(input.manifest.textBoxes);
  const policyRisk = checkPolicyRisk([
    input.manifest.primaryText,
    input.manifest.headline,
    input.manifest.description,
    ...input.manifest.textBoxes.map((box) => box.text)
  ].filter(Boolean).join(" "));
  const placement = input.manifest.placements?.length
    ? validatePlacement({ asset: input.manifest.asset, placements: input.manifest.placements })
    : undefined;
  const cost = input.cost ? guardCost(input.cost) : undefined;

  if (!input.pageId) blockers.push("page_id가 필요합니다.");
  if (!input.linkUrl && !input.manifest.linkUrl) blockers.push("link_url이 필요합니다.");
  if (!safeArea.passed) blockers.push("safe_area_pass 실패");
  if (!priceAccuracy.passed) blockers.push("price_accuracy_pass 실패");
  if (!forbiddenText.passed) blockers.push("forbidden_text_pass 실패");
  if (policyRisk.status === "blocked") blockers.push("policy risk가 차단 수준입니다.");
  if (placement?.error1487569Risk) blockers.push("#1487569 placement compatibility risk가 있습니다.");
  if (cost?.status === "blocked") blockers.push(cost.message);

  if (policyRisk.status === "needs_review") warnings.push("정책 위험 확인이 필요합니다.");
  if (placement?.status === "risky") warnings.push("placement crop/safe area 추가 검수가 필요합니다.");

  const approvalRequired = cost?.status === "approval_required" || blockers.length === 0;
  const status = blockers.length > 0 ? "blocked" : approvalRequired ? "approval_required" : "pass";

  return {
    status,
    checks: {
      safeArea,
      priceAccuracy,
      forbiddenText,
      policyRisk,
      placement,
      cost
    },
    approvalRequired,
    blockers,
    warnings
  };
}
