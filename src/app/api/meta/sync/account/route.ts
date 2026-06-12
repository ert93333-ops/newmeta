import { randomUUID } from "node:crypto";
import { handleError, fail, ok, parseWriteJson } from "@/lib/api/responses";
import { resolveUserContext } from "@/lib/api/context";
import { resolveMetaAdapter } from "@/lib/meta/resolve-meta-adapter";
import { getRepository } from "@/lib/repositories/hermes-repository";
import { assertRole } from "@/lib/security/rbac";
import { createSupabaseClient, getBearerAuthorization } from "@/lib/supabase/server";
import type { MetaAd, MetaAdAccount, MetaAdSet, MetaCampaign, MetaInsight } from "@/lib/types";

type SyncLevel = "account" | "campaign" | "adset" | "ad";

interface SyncAccountRequest {
  adAccountIds?: string[];
  datePreset?: "today" | "yesterday" | "last_7d" | "last_30d" | "maximum";
  levels?: SyncLevel[];
  breakdowns?: string[];
  includeCreatives?: boolean;
}

interface PersistedAccount {
  id: string;
  meta_ad_account_id: string;
}

interface PersistedCampaign {
  id: string;
  meta_campaign_id: string;
}

interface PersistedAdSet {
  id: string;
  meta_adset_id: string;
}

interface PersistedAd {
  id: string;
  meta_ad_id: string;
}

export async function POST(request: Request) {
  try {
    const context = await resolveUserContext(request);
    assertRole(context, "marketer");

    const body = (await parseWriteJson(request)) as SyncAccountRequest;
    const supabase = createSupabaseClient("user", getBearerAuthorization(request));
    if (!supabase) {
      return fail("SUPABASE_REQUIRED", "Supabase is required for persisted Meta account sync.", 500);
    }

    const repository = getRepository();
    const resolved = await resolveMetaAdapter({
      request,
      context,
      repository
    });
    const availableAccounts = await resolved.adapter.listAdAccounts();
    const requestedIds = new Set(body.adAccountIds ?? availableAccounts.map((account) => account.id));
    const accounts = availableAccounts.filter((account) => requestedIds.has(account.id));
    if (accounts.length === 0) {
      return fail("META_AD_ACCOUNT_NOT_FOUND", "No matching Meta ad accounts were returned for this tenant.", 404);
    }

    const levels = body.levels?.length ? body.levels : (["account", "campaign", "adset", "ad"] satisfies SyncLevel[]);
    const includeCreatives = body.includeCreatives ?? true;
    const summary = {
      id: randomUUID(),
      tenantId: context.tenantId,
      createdBy: context.userId,
      adapterMode: resolved.mode,
      connectionId: resolved.connectionId,
      requestedAdAccounts: [...requestedIds],
      accounts: 0,
      campaigns: 0,
      adsets: 0,
      ads: 0,
      creativesFetched: 0,
      creativeFetchErrors: 0,
      insightSnapshots: 0
    };

    for (const account of accounts) {
      const persistedAccount = await upsertAdAccount({
        supabase,
        context,
        connectionId: resolved.connectionId,
        account
      });
      summary.accounts += 1;

      const campaigns = await resolved.adapter.listCampaigns(account.id);
      const persistedCampaigns = await upsertCampaigns({ supabase, context, account: persistedAccount, campaigns });
      summary.campaigns += persistedCampaigns.length;
      const campaignIdMap = new Map(persistedCampaigns.map((campaign) => [campaign.meta_campaign_id, campaign.id]));

      const adsets: MetaAdSet[] = [];
      for (const campaign of campaigns) {
        adsets.push(...(await resolved.adapter.listAdSets(account.id, campaign.id)));
      }
      const persistedAdsets = await upsertAdSets({ supabase, context, account: persistedAccount, campaignIdMap, adsets });
      summary.adsets += persistedAdsets.length;
      const adsetIdMap = new Map(persistedAdsets.map((adset) => [adset.meta_adset_id, adset.id]));

      const ads: MetaAd[] = [];
      for (const adset of adsets) {
        ads.push(...(await resolved.adapter.listAds(account.id, adset.id)));
      }
      const creativePayloads = new Map<string, unknown>();
      if (includeCreatives) {
        for (const ad of ads) {
          if (!ad.creativeId) {
            continue;
          }
          try {
            creativePayloads.set(ad.id, await resolved.adapter.getCreative(ad.creativeId));
            summary.creativesFetched += 1;
          } catch {
            summary.creativeFetchErrors += 1;
          }
        }
      }
      const persistedAds = await upsertAds({ supabase, context, account: persistedAccount, adsetIdMap, ads, creativePayloads });
      summary.ads += persistedAds.length;
      const adIdMap = new Map(persistedAds.map((ad) => [ad.meta_ad_id, ad.id]));

      for (const level of levels) {
        const insights = await resolved.adapter.getInsights({
          adAccountId: account.id,
          level,
          datePreset: body.datePreset,
          breakdowns: body.breakdowns
        });
        summary.insightSnapshots += await insertInsightSnapshots({
          supabase,
          context,
          account: persistedAccount,
          level,
          insights,
          campaignIdMap,
          adsetIdMap,
          adIdMap
        });
      }
    }

    const job = {
      id: summary.id,
      tenantId: context.tenantId,
      createdBy: context.userId,
      status: "succeeded",
      type: "meta_account_backfill",
      input: {
        adAccountIds: body.adAccountIds,
        datePreset: body.datePreset ?? "last_30d",
        levels,
        breakdowns: body.breakdowns ?? [],
        includeCreatives,
        adapterMode: resolved.mode
      },
      result: summary
    };
    await repository.saveJob(request, job);
    await repository.saveAuditLog(request, {
      tenantId: context.tenantId,
      userId: context.userId,
      action: "meta_account_backfill",
      objectType: "meta_account",
      afterJson: summary,
      result: "succeeded"
    });

    return ok(job, 201);
  } catch (error) {
    return handleError(error);
  }
}

async function upsertAdAccount(input: {
  supabase: NonNullable<ReturnType<typeof createSupabaseClient>>;
  context: { tenantId: string; userId: string };
  connectionId?: string;
  account: MetaAdAccount;
}): Promise<PersistedAccount> {
  const { data, error } = await input.supabase
    .from("ad_accounts")
    .upsert(
      {
        tenant_id: input.context.tenantId,
        created_by: input.context.userId,
        connection_id: input.connectionId,
        meta_ad_account_id: input.account.id,
        name: input.account.name,
        currency: input.account.currency,
        timezone_name: input.account.timezoneName,
        status: "synced",
        raw_json: input.account
      },
      { onConflict: "tenant_id,meta_ad_account_id" }
    )
    .select("id, meta_ad_account_id")
    .single();
  if (error) {
    throw new Error(`SUPABASE_AD_ACCOUNT_UPSERT_FAILED:${error.message}`);
  }
  return data as PersistedAccount;
}

async function upsertCampaigns(input: {
  supabase: NonNullable<ReturnType<typeof createSupabaseClient>>;
  context: { tenantId: string; userId: string };
  account: PersistedAccount;
  campaigns: MetaCampaign[];
}): Promise<PersistedCampaign[]> {
  if (input.campaigns.length === 0) {
    return [];
  }
  const { data, error } = await input.supabase
    .from("campaigns_cache")
    .upsert(
      input.campaigns.map((campaign) => ({
        tenant_id: input.context.tenantId,
        created_by: input.context.userId,
        ad_account_id: input.account.id,
        meta_campaign_id: campaign.id,
        name: campaign.name,
        objective: campaign.objective,
        status: campaign.status,
        raw_json: campaign,
        synced_at: new Date().toISOString()
      })),
      { onConflict: "tenant_id,meta_campaign_id" }
    )
    .select("id, meta_campaign_id");
  if (error) {
    throw new Error(`SUPABASE_CAMPAIGN_UPSERT_FAILED:${error.message}`);
  }
  return (data ?? []) as PersistedCampaign[];
}

async function upsertAdSets(input: {
  supabase: NonNullable<ReturnType<typeof createSupabaseClient>>;
  context: { tenantId: string; userId: string };
  account: PersistedAccount;
  campaignIdMap: Map<string, string>;
  adsets: MetaAdSet[];
}): Promise<PersistedAdSet[]> {
  if (input.adsets.length === 0) {
    return [];
  }
  const { data, error } = await input.supabase
    .from("adsets_cache")
    .upsert(
      input.adsets.map((adset) => ({
        tenant_id: input.context.tenantId,
        created_by: input.context.userId,
        ad_account_id: input.account.id,
        campaign_id: input.campaignIdMap.get(adset.campaignId),
        meta_adset_id: adset.id,
        name: adset.name,
        optimization_goal: adset.optimizationGoal,
        status: adset.status,
        targeting_json: adset.targeting ?? {},
        raw_json: adset,
        synced_at: new Date().toISOString()
      })),
      { onConflict: "tenant_id,meta_adset_id" }
    )
    .select("id, meta_adset_id");
  if (error) {
    throw new Error(`SUPABASE_ADSET_UPSERT_FAILED:${error.message}`);
  }
  return (data ?? []) as PersistedAdSet[];
}

async function upsertAds(input: {
  supabase: NonNullable<ReturnType<typeof createSupabaseClient>>;
  context: { tenantId: string; userId: string };
  account: PersistedAccount;
  adsetIdMap: Map<string, string>;
  ads: MetaAd[];
  creativePayloads: Map<string, unknown>;
}): Promise<PersistedAd[]> {
  if (input.ads.length === 0) {
    return [];
  }
  const { data, error } = await input.supabase
    .from("ads_cache")
    .upsert(
      input.ads.map((ad) => ({
        tenant_id: input.context.tenantId,
        created_by: input.context.userId,
        ad_account_id: input.account.id,
        adset_id: input.adsetIdMap.get(ad.adsetId),
        meta_ad_id: ad.id,
        meta_creative_id: ad.creativeId,
        name: ad.name,
        status: ad.status,
        raw_json: {
          ...ad,
          creative: input.creativePayloads.get(ad.id)
        },
        synced_at: new Date().toISOString()
      })),
      { onConflict: "tenant_id,meta_ad_id" }
    )
    .select("id, meta_ad_id");
  if (error) {
    throw new Error(`SUPABASE_AD_UPSERT_FAILED:${error.message}`);
  }
  return (data ?? []) as PersistedAd[];
}

async function insertInsightSnapshots(input: {
  supabase: NonNullable<ReturnType<typeof createSupabaseClient>>;
  context: { tenantId: string; userId: string };
  account: PersistedAccount;
  level: SyncLevel;
  insights: MetaInsight[];
  campaignIdMap: Map<string, string>;
  adsetIdMap: Map<string, string>;
  adIdMap: Map<string, string>;
}): Promise<number> {
  if (input.insights.length === 0) {
    return 0;
  }
  const { error } = await input.supabase.from("insights_snapshots").insert(
    input.insights.map((insight) => ({
      tenant_id: input.context.tenantId,
      created_by: input.context.userId,
      ad_account_id: input.account.id,
      campaign_id: insight.campaignId ? input.campaignIdMap.get(insight.campaignId) : undefined,
      adset_id: insight.adsetId ? input.adsetIdMap.get(insight.adsetId) : undefined,
      ad_id: insight.adId ? input.adIdMap.get(insight.adId) : undefined,
      level: input.level,
      date_start: insight.dateStart,
      date_stop: insight.dateStop,
      spend: insight.spend,
      impressions: insight.impressions,
      reach: insight.reach,
      frequency: insight.frequency,
      clicks: insight.clicks,
      link_clicks: insight.linkClicks,
      outbound_clicks: insight.outboundClicks,
      landing_page_views: insight.landingPageViews,
      add_to_cart: insight.addToCart,
      purchases: insight.purchases,
      ctr: insight.ctr,
      cpc: insight.cpc,
      cpm: insight.cpm,
      purchase_roas: insight.purchaseRoas,
      breakdowns_json: insight.breakdowns ?? {},
      actions_json: {},
      raw_json: insight
    }))
  );
  if (error) {
    throw new Error(`SUPABASE_INSIGHTS_INSERT_FAILED:${error.message}`);
  }
  return input.insights.length;
}
