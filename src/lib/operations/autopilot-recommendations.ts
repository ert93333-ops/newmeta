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
}

export interface AutopilotRecommendationResult {
  mode: "read_only";
  budgetMutationBlocked: true;
  activeMutationBlocked: true;
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
  if ((insights ?? []).length === 0) {
    recommendations.push({
      severity: "high",
      action: "meta_account_backfill_required",
      reason: "저장된 ad-level 인사이트가 없습니다.",
      nextStep: "POST /api/meta/sync/account를 먼저 실행해 기존 광고 성과와 소재 메타데이터를 가져오십시오.",
      confidence: "high"
    });
  } else if (staleOrMissingCreativeCount > 0) {
    recommendations.push({
      severity: "medium",
      action: "creative_metadata_resync",
      reason: `${staleOrMissingCreativeCount}개 광고에 소재 메타데이터가 비어 있습니다.`,
      nextStep: "includeCreatives=true로 Meta account backfill을 재실행하십시오.",
      confidence: "medium"
    });
  }

  return {
    mode: "read_only",
    budgetMutationBlocked: true,
    activeMutationBlocked: true,
    tenantId,
    source: {
      insightRows: (insights ?? []).length,
      ads: (ads ?? []).length,
      evaluatedAds: latestByAd.length,
      latestInsightAt: (insights ?? [])[0]?.created_at
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
        {
          ...base,
          severity: "observe",
          action: "observe_until_signal",
          reason: `노출 ${impressions}건으로 판단 신뢰도가 낮습니다.`,
          nextStep: "추가 집행 데이터를 관찰하고 자동 변경은 보류하십시오.",
          confidence: "low"
        }
      ];
    }

    if (ctr < 1 && impressions >= 1000) {
      return [
        {
          ...base,
          severity: "high",
          action: "creative_hook_test",
          reason: `CTR ${ctr.toFixed(2)}%로 hook/첫 화면 주목도가 약합니다.`,
          nextStep: "소재 분석을 실행하고 hook 또는 첫 3초 변형 초안을 생성하십시오.",
          confidence: "high"
        }
      ];
    }

    if (insight.link_clicks >= 20 && landingRate > 0 && landingRate < 0.55) {
      return [
        {
          ...base,
          severity: "medium",
          action: "landing_arrival_diagnostic",
          reason: `링크 클릭 대비 랜딩 도달률이 ${(landingRate * 100).toFixed(1)}%입니다.`,
          nextStep: "랜딩 속도, URL, Pixel/CAPI/GA4 진단을 우선 확인하십시오.",
          confidence: "medium"
        }
      ];
    }

    if (frequency >= 2.5 && ctr < 1.5) {
      return [
        {
          ...base,
          severity: "medium",
          action: "fatigue_creative_refresh",
          reason: `빈도 ${frequency.toFixed(2)}에서 CTR이 ${ctr.toFixed(2)}%로 낮습니다.`,
          nextStep: "새 hook/비주얼 변형을 PAUSED 초안으로 준비하십시오.",
          confidence: "medium"
        }
      ];
    }

    if (spend >= 50000 && conversionSignal === 0) {
      return [
        {
          ...base,
          severity: "high",
          action: "offer_or_product_page_review",
          reason: `지출 ${Math.round(spend).toLocaleString("ko-KR")}원 동안 구매/장바구니 신호가 없습니다.`,
          nextStep: "오퍼 명확성, 가격 표시, 상세페이지 전환 저항을 점검하십시오.",
          confidence: "medium"
        }
      ];
    }

    return [
      {
        ...base,
        severity: "low",
        action: "continue_observation",
        reason: "현재 자동 차단 또는 고위험 병목 조건이 감지되지 않았습니다.",
        nextStep: "다음 백필 주기까지 관찰하고 성과 변화만 추적하십시오.",
        confidence: "medium"
      }
    ];
  });
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
