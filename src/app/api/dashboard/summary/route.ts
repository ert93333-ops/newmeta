import { handleError, fail, ok } from "@/lib/api/responses";
import { resolveUserContext } from "@/lib/api/context";
import { createSupabaseClient, getBearerAuthorization } from "@/lib/supabase/server";

interface InsightRow {
  ad_id?: string | null;
  spend: number | string;
  impressions: number;
  reach: number;
  clicks: number;
  link_clicks: number;
  landing_page_views: number;
  purchases: number;
  add_to_cart: number;
  ctr: number | string;
  cpc: number | string;
  cpm: number | string;
  purchase_roas?: number | string | null;
  created_at: string;
}

interface AdRow {
  id: string;
  meta_ad_id: string;
  name: string;
  status?: string | null;
  raw_json?: unknown;
}

export async function GET(request: Request) {
  try {
    const context = await resolveUserContext(request);
    const supabase = createSupabaseClient("user", getBearerAuthorization(request));
    if (!supabase) {
      return fail("SUPABASE_REQUIRED", "Supabase is required for dashboard summary.", 500);
    }

    const [accounts, campaigns, adsets, ads, insights, recommendations] = await Promise.all([
      countRows(supabase, "ad_accounts", context.tenantId),
      countRows(supabase, "campaigns_cache", context.tenantId),
      countRows(supabase, "adsets_cache", context.tenantId),
      loadAds(supabase, context.tenantId),
      loadInsights(supabase, context.tenantId),
      loadRecommendations(request)
    ]);

    const adMap = new Map(ads.map((ad) => [ad.id, ad]));
    const totals = insights.reduce(
      (acc, row) => ({
        spend: acc.spend + toNumber(row.spend),
        impressions: acc.impressions + row.impressions,
        clicks: acc.clicks + row.clicks,
        linkClicks: acc.linkClicks + row.link_clicks,
        landingPageViews: acc.landingPageViews + row.landing_page_views,
        purchases: acc.purchases + row.purchases,
        addToCart: acc.addToCart + row.add_to_cart
      }),
      {
        spend: 0,
        impressions: 0,
        clicks: 0,
        linkClicks: 0,
        landingPageViews: 0,
        purchases: 0,
        addToCart: 0
      }
    );
    const activeAds = ads.filter((ad) => ad.status === "ACTIVE").length;
    const pausedAds = ads.filter((ad) => ad.status === "PAUSED").length;
    const adsWithCreativeMetadata = ads.filter((ad) => hasCreativeMetadata(ad.raw_json)).length;
    const topAds = insights
      .map((row) => {
        const ad = row.ad_id ? adMap.get(row.ad_id) : undefined;
        return {
          adId: row.ad_id,
          metaAdId: ad?.meta_ad_id,
          name: ad?.name ?? "이름 없는 광고",
          status: ad?.status ?? "UNKNOWN",
          spend: toNumber(row.spend),
          impressions: row.impressions,
          purchases: row.purchases,
          addToCart: row.add_to_cart,
          ctr: toNumber(row.ctr),
          cpc: toNumber(row.cpc),
          cpm: toNumber(row.cpm),
          purchaseRoas: toNumber(row.purchase_roas),
          creativeReady: hasCreativeMetadata(ad?.raw_json)
        };
      })
      .sort((left, right) => right.spend - left.spend)
      .slice(0, 8);

    return ok({
      tenantId: context.tenantId,
      generatedAt: new Date().toISOString(),
      counts: {
        accounts,
        campaigns,
        adsets,
        ads: ads.length,
        activeAds,
        pausedAds,
        adsWithCreativeMetadata,
        insightRows: insights.length
      },
      totals: {
        ...totals,
        ctr: totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0,
        landingRate: totals.linkClicks > 0 ? (totals.landingPageViews / totals.linkClicks) * 100 : 0,
        purchaseRate: totals.landingPageViews > 0 ? (totals.purchases / totals.landingPageViews) * 100 : 0
      },
      topAds,
      recommendations: recommendations.slice(0, 6),
      safety: {
        budgetChangesExecutable: false,
        activationRequiresApproval: true,
        customerTokensServerOnly: true
      }
    });
  } catch (error) {
    return handleError(error);
  }
}

async function countRows(supabase: NonNullable<ReturnType<typeof createSupabaseClient>>, table: string, tenantId: string): Promise<number> {
  const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
  if (error) {
    throw new Error(`SUPABASE_DASHBOARD_COUNT_FAILED:${table}:${error.message}`);
  }
  return count ?? 0;
}

async function loadAds(supabase: NonNullable<ReturnType<typeof createSupabaseClient>>, tenantId: string): Promise<AdRow[]> {
  const { data, error } = await supabase
    .from("ads_cache")
    .select("id, meta_ad_id, name, status, raw_json")
    .eq("tenant_id", tenantId)
    .order("updated_at", { ascending: false })
    .limit(250);
  if (error) {
    throw new Error(`SUPABASE_DASHBOARD_ADS_FAILED:${error.message}`);
  }
  return (data ?? []) as AdRow[];
}

async function loadInsights(supabase: NonNullable<ReturnType<typeof createSupabaseClient>>, tenantId: string): Promise<InsightRow[]> {
  const { data, error } = await supabase
    .from("insights_snapshots")
    .select(
      "ad_id, spend, impressions, reach, clicks, link_clicks, landing_page_views, purchases, add_to_cart, ctr, cpc, cpm, purchase_roas, created_at"
    )
    .eq("tenant_id", tenantId)
    .eq("level", "ad")
    .order("created_at", { ascending: false })
    .limit(250);
  if (error) {
    throw new Error(`SUPABASE_DASHBOARD_INSIGHTS_FAILED:${error.message}`);
  }
  return (data ?? []) as InsightRow[];
}

async function loadRecommendations(request: Request): Promise<unknown[]> {
  const url = new URL(request.url);
  const response = await fetch(new URL("/api/operations/autopilot/recommendations", url.origin), {
    headers: {
      authorization: request.headers.get("authorization") ?? "",
      "x-tenant-id": request.headers.get("x-tenant-id") ?? ""
    },
    cache: "no-store"
  });
  if (!response.ok) {
    return [];
  }
  const body = (await response.json()) as { recommendations?: unknown[] };
  return body.recommendations ?? [];
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
