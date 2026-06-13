import type { createSupabaseClient } from "@/lib/supabase/server";

type SupabaseClient = NonNullable<ReturnType<typeof createSupabaseClient>>;

interface InsightRow {
  id: string;
  ad_id?: string | null;
  spend: number | string;
  impressions: number;
  reach: number;
  frequency: number | string;
  clicks: number;
  link_clicks: number;
  outbound_clicks: number;
  landing_page_views: number;
  add_to_cart: number;
  purchases: number;
  ctr: number | string;
  cpc: number | string;
  cpm: number | string;
  purchase_roas?: number | string | null;
  date_start?: string | null;
  date_stop?: string | null;
  created_at: string;
}

interface AdRow {
  id: string;
  meta_ad_id: string;
  meta_creative_id?: string | null;
  name: string;
  status?: string | null;
  raw_json?: unknown;
}

export interface AutopilotRecommendation {
  adId?: string;
  metaAdId?: string;
  adName?: string;
  severity: "observe" | "low" | "medium" | "high";
  action: string;
  reason: string;
  nextStep: string;
  confidence: "low" | "medium" | "high";
  creativeBrief: {
    recommendedPrompt: string;
    changedVariable: string;
    controlledVariables: string[];
    objective: string;
  };
  operationPlan: {
    registrationMode: "paused_draft_after_qa";
    approvalGate: string;
    steps: string[];
    abTest: {
      control: string;
      variant: string;
      primaryMetric: string;
      secondaryMetrics: string[];
      minimumData: string;
      stopCondition: string;
    };
    automationBoundaries: string[];
  };
  complianceGate: {
    status: "PASS" | "PASS_WITH_LOG" | "HOLD_FOR_REVIEW" | "BLOCK" | "QUARANTINE";
    checks: string[];
    blockedReasons: string[];
  };
  decisionProposal: {
    agentName: "autopilot_recommendation_agent";
    controllerVersion: "rule_based_v1";
    actionType:
      | "NOOP"
      | "CREATE_VARIANT"
      | "ROTATE_CREATIVE"
      | "HOLD_SCALING_ON_DATA_DRIFT"
      | "REQUEST_HUMAN_APPROVAL";
    reasonCode: string;
    riskLevel: "LOW" | "MEDIUM" | "HIGH";
    requiresHumanApproval: boolean;
    autoExecutable: false;
    executionOwner: "action_orchestrator";
  };
  experimentPlan: {
    status: "DRAFT";
    variableToChange: string;
    fixedVariables: string[];
    primaryMetric: string;
    guardrailMetrics: string[];
    minimumRuntime: string;
    sampleGuard: string;
  };
  rollbackPlan: {
    requiredBeforeExecution: true;
    snapshotScope: string[];
    rollbackAction: string;
  };
}

export interface AutopilotRecommendationResult {
  mode: "read_only";
  requestedMode: "PROPOSE_ONLY";
  autonomyLevel: "RECOMMENDATION";
  budgetMutationBlocked: true;
  activeMutationBlocked: true;
  execution: {
    singleWriter: "action_orchestrator";
    directMetaWritesBlocked: true;
    executableBudgetActionsBlocked: true;
    approvalRequiredForPublish: true;
  };
  dataQualityGates: Array<{
    rule: string;
    severity: "LOW" | "MEDIUM" | "HIGH";
    status: "pass" | "hold" | "block";
    action: string;
  }>;
  killSwitch: {
    evaluated: true;
    status: "clear" | "hold";
    reasons: string[];
  };
  tenantId: string;
  source: {
    insightRows: number;
    ads: number;
    evaluatedAds: number;
    latestInsightAt?: string;
  };
  recommendations: AutopilotRecommendation[];
}

export async function loadAutopilotRecommendations(
  supabase: SupabaseClient,
  tenantId: string
): Promise<AutopilotRecommendationResult> {
  const { data: insights, error: insightsError } = await supabase
    .from("insights_snapshots")
    .select(
      "id, ad_id, spend, impressions, reach, frequency, clicks, link_clicks, outbound_clicks, landing_page_views, add_to_cart, purchases, ctr, cpc, cpm, purchase_roas, date_start, date_stop, created_at"
    )
    .eq("tenant_id", tenantId)
    .eq("level", "ad")
    .order("created_at", { ascending: false })
    .limit(250);
  if (insightsError) {
    throw new Error(`SUPABASE_AUTOPILOT_INSIGHTS_SELECT_FAILED:${insightsError.message}`);
  }

  const adIds = [...new Set((insights ?? []).map((row) => row.ad_id).filter((id): id is string => Boolean(id)))];
  const { data: ads, error: adsError } =
    adIds.length > 0
      ? await supabase
          .from("ads_cache")
          .select("id, meta_ad_id, meta_creative_id, name, status, raw_json")
          .eq("tenant_id", tenantId)
          .in("id", adIds)
      : { data: [], error: null };
  if (adsError) {
    throw new Error(`SUPABASE_AUTOPILOT_ADS_SELECT_FAILED:${adsError.message}`);
  }

  const adMap = new Map((ads ?? []).map((ad) => [ad.id, ad as AdRow]));
  const latestByAd = latestInsightByAd((insights ?? []) as InsightRow[]);
  const recommendations = buildRecommendations(latestByAd, adMap);
  const staleOrMissingCreativeCount = (ads ?? []).filter((ad) => !hasCreativeMetadata(ad.raw_json)).length;
  const latestInsightAt = (insights ?? [])[0]?.created_at;
  const dataQualityGates = buildDataQualityGates({
    insightRows: (insights ?? []).length,
    latestInsightAt,
    staleOrMissingCreativeCount
  });
  const killSwitch = evaluateKillSwitch(dataQualityGates);

  if ((insights ?? []).length === 0) {
    recommendations.push(
      withCreativeOps({
        severity: "high",
        action: "meta_account_backfill_required",
        reason: "No persisted ad-level insight snapshots are available.",
        nextStep: "Run POST /api/meta/sync/account first so Hermes can load ad performance and creative metadata.",
        confidence: "high"
      })
    );
  } else if (staleOrMissingCreativeCount > 0) {
    recommendations.push(
      withCreativeOps({
        severity: "medium",
        action: "creative_metadata_resync",
        reason: `${staleOrMissingCreativeCount} ads are missing creative metadata.`,
        nextStep: "Run Meta account backfill again with includeCreatives=true before generating new variants.",
        confidence: "medium"
      })
    );
  }

  return {
    mode: "read_only",
    requestedMode: "PROPOSE_ONLY",
    autonomyLevel: "RECOMMENDATION",
    budgetMutationBlocked: true,
    activeMutationBlocked: true,
    execution: {
      singleWriter: "action_orchestrator",
      directMetaWritesBlocked: true,
      executableBudgetActionsBlocked: true,
      approvalRequiredForPublish: true
    },
    dataQualityGates,
    killSwitch,
    tenantId,
    source: {
      insightRows: (insights ?? []).length,
      ads: (ads ?? []).length,
      evaluatedAds: latestByAd.length,
      latestInsightAt
    },
    recommendations: recommendations.slice(0, 50)
  };
}

function latestInsightByAd(insights: InsightRow[]): InsightRow[] {
  const byAd = new Map<string, InsightRow>();
  for (const insight of insights) {
    if (!insight.ad_id || byAd.has(insight.ad_id)) {
      continue;
    }
    byAd.set(insight.ad_id, insight);
  }
  return [...byAd.values()];
}

function buildRecommendations(insights: InsightRow[], adMap: Map<string, AdRow>): AutopilotRecommendation[] {
  return insights.flatMap<AutopilotRecommendation>((insight): AutopilotRecommendation[] => {
    const ad = insight.ad_id ? adMap.get(insight.ad_id) : undefined;
    const spend = toNumber(insight.spend);
    const impressions = insight.impressions;
    const ctr = toNumber(insight.ctr);
    const frequency = toNumber(insight.frequency);
    const landingRate = insight.link_clicks > 0 ? insight.landing_page_views / insight.link_clicks : 0;
    const conversionSignal = insight.purchases + insight.add_to_cart;
    const base = {
      adId: insight.ad_id ?? undefined,
      metaAdId: ad?.meta_ad_id,
      adName: ad?.name
    };

    if (impressions < 500) {
      return [
        withCreativeOps({
          ...base,
          severity: "observe",
          action: "observe_until_signal",
          reason: `Only ${impressions.toLocaleString("ko-KR")} impressions are available, so signal is still weak.`,
          nextStep: "Keep observing before changing delivery, budget, or publish state.",
          confidence: "low"
        })
      ];
    }

    if (ctr < 1 && impressions >= 1000) {
      return [
        withCreativeOps({
          ...base,
          severity: "high",
          action: "creative_hook_test",
          reason: `CTR is ${ctr.toFixed(2)}%, so the hook or first-screen attention is likely weak.`,
          nextStep: "Generate a controlled hook variant and route it as a PAUSED draft after QA.",
          confidence: "high"
        })
      ];
    }

    if (insight.link_clicks >= 20 && landingRate > 0 && landingRate < 0.55) {
      return [
        withCreativeOps({
          ...base,
          severity: "medium",
          action: "landing_arrival_diagnostic",
          reason: `Landing arrival rate is ${(landingRate * 100).toFixed(1)}% from link clicks.`,
          nextStep: "Clarify CTA and destination expectation, then validate Pixel/CAPI/GA4 separately.",
          confidence: "medium"
        })
      ];
    }

    if (frequency >= 2.5 && ctr < 1.5) {
      return [
        withCreativeOps({
          ...base,
          severity: "medium",
          action: "fatigue_creative_refresh",
          reason: `Frequency is ${frequency.toFixed(2)} while CTR is ${ctr.toFixed(2)}%, which suggests fatigue.`,
          nextStep: "Prepare a fresh visual-angle variant as a PAUSED draft without changing audience or budget.",
          confidence: "medium"
        })
      ];
    }

    if (spend >= 50000 && conversionSignal === 0) {
      return [
        withCreativeOps({
          ...base,
          severity: "high",
          action: "offer_or_product_page_review",
          reason: `Spend is ${Math.round(spend).toLocaleString("ko-KR")} KRW with no purchase or add-to-cart signal.`,
          nextStep: "Generate an offer-clarity variant and verify product page friction before publishing.",
          confidence: "medium"
        })
      ];
    }

    return [
      withCreativeOps({
        ...base,
        severity: "low",
        action: "continue_observation",
        reason: "No high-risk bottleneck condition is currently detected.",
        nextStep: "Continue observation and prepare only controlled variants from stronger signals.",
        confidence: "medium"
      })
    ];
  });
}

function withCreativeOps(input: {
  adId?: string;
  metaAdId?: string;
  adName?: string;
  severity: "observe" | "low" | "medium" | "high";
  action: string;
  reason: string;
  nextStep: string;
  confidence: "low" | "medium" | "high";
}): AutopilotRecommendation {
  const strategy = creativeStrategyForAction(input.action);
  const controlName = input.adName ?? input.metaAdId ?? "current best-matching ad";
  const recommendedPrompt = [
    `Create a Meta ad ${strategy.assetType} variant based on ${controlName}.`,
    `Objective: ${strategy.objective}.`,
    `Change only: ${strategy.changedVariable}.`,
    `Keep controlled: ${strategy.controlledVariables.join(", ")}.`,
    "Use final upload-ready creative only, with no safezone labels, pixel labels, or guide text.",
    "Respect feed, stories, and reels placement constraints and avoid unsupported placement/creative combinations."
  ].join(" ");

  return {
    ...input,
    creativeBrief: {
      recommendedPrompt,
      changedVariable: strategy.changedVariable,
      controlledVariables: strategy.controlledVariables,
      objective: strategy.objective
    },
    operationPlan: {
      registrationMode: "paused_draft_after_qa",
      approvalGate:
        "Generate asset only after paid AI approval; register Meta ads only as PAUSED drafts; ACTIVE requires separate approval.",
      steps: [
        "Generate one upload-ready creative from the recommended brief.",
        "Run safe area, price accuracy, forbidden text, and placement compatibility checks.",
        "Create a PAUSED Meta draft with the validated asset and existing campaign/ad set context.",
        "Route the draft through Approval Center before any publish or status change.",
        "Monitor Meta insights and keep budget changes recommendation-only."
      ],
      abTest: {
        control: controlName,
        variant: `${strategy.changedVariable} variant`,
        primaryMetric: strategy.primaryMetric,
        secondaryMetrics: ["CTR", "LPV rate", "ATC rate", "purchase rate"],
        minimumData: "impressions >= 1,500, link_clicks >= 50, landing_page_views >= 30",
        stopCondition:
          input.confidence === "high"
            ? "Stop only after minimum data is reached or policy/cost guard blocks the run."
            : "Keep observing until minimum data is reached; do not call a winner on weak signal."
      },
      automationBoundaries: [
        "No budget mutation API is available.",
        "No ACTIVE transition runs without explicit approval.",
        "No destructive action runs without the required approval policy.",
        "All Meta write execution must go through the single-writer Action Orchestrator."
      ]
    },
    complianceGate: complianceGateForAction(input.action),
    decisionProposal: {
      agentName: "autopilot_recommendation_agent",
      controllerVersion: "rule_based_v1",
      actionType: actionTypeForRecommendation(input.action),
      reasonCode: reasonCodeForRecommendation(input.action),
      riskLevel: riskLevelForSeverity(input.severity),
      requiresHumanApproval: true,
      autoExecutable: false,
      executionOwner: "action_orchestrator"
    },
    experimentPlan: {
      status: "DRAFT",
      variableToChange: strategy.changedVariable,
      fixedVariables: strategy.controlledVariables,
      primaryMetric: strategy.primaryMetric,
      guardrailMetrics: ["policy_risk", "negative_comment_rate", "LPV rate", "purchase rate"],
      minimumRuntime: "24 hours after first delivery, then until minimum sample is reached",
      sampleGuard: "Do not select a winner before impressions >= 1,500 and link_clicks >= 50."
    },
    rollbackPlan: {
      requiredBeforeExecution: true,
      snapshotScope: ["campaign", "adset", "ad", "creative", "landing_url", "status"],
      rollbackAction: "Revert to the previous approved PAUSED draft or previous active creative after Action Orchestrator review."
    }
  };
}

function buildDataQualityGates(input: {
  insightRows: number;
  latestInsightAt?: string;
  staleOrMissingCreativeCount: number;
}): AutopilotRecommendationResult["dataQualityGates"] {
  const gates: AutopilotRecommendationResult["dataQualityGates"] = [];
  const latestAgeHours = input.latestInsightAt ? (Date.now() - Date.parse(input.latestInsightAt)) / 36e5 : Number.POSITIVE_INFINITY;

  gates.push({
    rule: input.insightRows > 0 ? "INSIGHTS_PRESENT" : "INSIGHTS_MISSING",
    severity: "HIGH",
    status: input.insightRows > 0 ? "pass" : "block",
    action: input.insightRows > 0 ? "allow proposal generation" : "hold autopilot until Meta insights are synced"
  });
  gates.push({
    rule: "INSIGHTS_STALE",
    severity: "HIGH",
    status: latestAgeHours <= 6 ? "pass" : "hold",
    action: latestAgeHours <= 6 ? "allow latest-window recommendations" : "hold scale/pause decisions and refresh insights"
  });
  gates.push({
    rule: "CREATIVE_JOIN_MISSING",
    severity: "MEDIUM",
    status: input.staleOrMissingCreativeCount > 0 ? "hold" : "pass",
    action:
      input.staleOrMissingCreativeCount > 0
        ? "hold creative replacement execution until ad-to-creative metadata is backfilled"
        : "allow creative proposal analysis"
  });
  gates.push({
    rule: "BUDGET_MUTATION_HARD_BLOCKED",
    severity: "HIGH",
    status: "pass",
    action: "budget recommendations stay text-only; no executable budget fields are emitted"
  });
  return gates;
}

function evaluateKillSwitch(dataQualityGates: AutopilotRecommendationResult["dataQualityGates"]) {
  const reasons = dataQualityGates
    .filter((gate) => gate.status === "block")
    .map((gate) => `${gate.rule}:${gate.action}`);
  return {
    evaluated: true as const,
    status: reasons.length > 0 ? ("hold" as const) : ("clear" as const),
    reasons
  };
}

function complianceGateForAction(action: string): AutopilotRecommendation["complianceGate"] {
  if (action === "meta_account_backfill_required" || action === "creative_metadata_resync") {
    return {
      status: "HOLD_FOR_REVIEW",
      checks: ["data_quality", "creative_metadata_join", "tenant_scope"],
      blockedReasons: ["Data backfill is required before any creative or delivery action can be executed."]
    };
  }
  return {
    status: "PASS_WITH_LOG",
    checks: ["policy_risk", "rights_status", "placement_fit", "landing_match", "approval_required"],
    blockedReasons: []
  };
}

function actionTypeForRecommendation(action: string): AutopilotRecommendation["decisionProposal"]["actionType"] {
  if (action === "creative_hook_test" || action === "offer_or_product_page_review") {
    return "CREATE_VARIANT";
  }
  if (action === "fatigue_creative_refresh") {
    return "ROTATE_CREATIVE";
  }
  if (action === "landing_arrival_diagnostic" || action === "creative_metadata_resync") {
    return "HOLD_SCALING_ON_DATA_DRIFT";
  }
  if (action === "meta_account_backfill_required") {
    return "REQUEST_HUMAN_APPROVAL";
  }
  return "NOOP";
}

function reasonCodeForRecommendation(action: string): string {
  const codes: Record<string, string> = {
    observe_until_signal: "LOW_SAMPLE_OBSERVE",
    continue_observation: "NO_HIGH_RISK_BOTTLENECK",
    creative_hook_test: "LOW_CTR_HOOK_TEST",
    landing_arrival_diagnostic: "LPV_RATE_DRIFT",
    fatigue_creative_refresh: "FREQUENCY_FATIGUE",
    offer_or_product_page_review: "SPEND_WITHOUT_CONVERSION_SIGNAL",
    creative_metadata_resync: "CREATIVE_JOIN_MISSING",
    meta_account_backfill_required: "INSIGHTS_MISSING"
  };
  return codes[action] ?? "AUTOPILOT_RECOMMENDATION";
}

function riskLevelForSeverity(severity: AutopilotRecommendation["severity"]): AutopilotRecommendation["decisionProposal"]["riskLevel"] {
  if (severity === "high") return "HIGH";
  if (severity === "medium") return "MEDIUM";
  return "LOW";
}

function creativeStrategyForAction(action: string) {
  const controlledVariables = ["audience", "landing URL", "offer facts", "campaign objective", "budget"];
  switch (action) {
    case "creative_hook_test":
      return {
        assetType: "image",
        changedVariable: "hook",
        controlledVariables,
        objective: "increase thumb-stop and CTR by changing the first visible hook only",
        primaryMetric: "CTR"
      };
    case "landing_arrival_diagnostic":
      return {
        assetType: "image",
        changedVariable: "CTA clarity",
        controlledVariables,
        objective: "make click intent and destination expectation clearer before the click",
        primaryMetric: "LPV rate"
      };
    case "fatigue_creative_refresh":
      return {
        assetType: "image",
        changedVariable: "visual angle",
        controlledVariables,
        objective: "refresh attention while preserving the proven offer and audience",
        primaryMetric: "CTR recovery"
      };
    case "offer_or_product_page_review":
      return {
        assetType: "image",
        changedVariable: "offer framing",
        controlledVariables,
        objective: "clarify price, value, and product reason-to-buy without inventing claims",
        primaryMetric: "ATC rate"
      };
    case "creative_metadata_resync":
    case "meta_account_backfill_required":
      return {
        assetType: "image",
        changedVariable: "data readiness",
        controlledVariables,
        objective: "prepare generation only after Meta creative and insight data are available",
        primaryMetric: "data completeness"
      };
    default:
      return {
        assetType: "image",
        changedVariable: "single creative angle",
        controlledVariables,
        objective: "prepare a controlled variant while preserving existing learnings",
        primaryMetric: "CTR"
      };
  }
}

function hasCreativeMetadata(rawJson: unknown): boolean {
  return Boolean(rawJson && typeof rawJson === "object" && "creative" in rawJson && rawJson.creative);
}

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
