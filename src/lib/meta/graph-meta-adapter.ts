import { assertExecutableApproval } from "@/lib/approval/approval-policy";
import { assertNoBudgetMutation } from "@/lib/guards/budget-guard";
import { assertNoCredentialPayload } from "@/lib/guards/credential-guard";
import type {
  CreateAdRequest,
  CreateAdSetRequest,
  CreateCampaignRequest,
  CreateCreativeRequest,
  MetaAdapter,
  UploadAssetRequest
} from "@/lib/meta/meta-adapter";
import { assertLiveMetaAdSetInput } from "@/lib/meta/live-draft-validation";
import { MockMetaAdapter } from "@/lib/meta/mock-meta-adapter";
import type { MetaAdAccount, MetaInsight } from "@/lib/types";

const graphExecutor = {
  userId: "00000000-0000-0000-0000-000000000000",
  tenantId: "00000000-0000-0000-0000-000000000001",
  role: "owner" as const
};

export class MetaGraphApiAdapter extends MockMetaAdapter implements MetaAdapter {
  private readonly accessToken: string;
  private readonly graphVersion: string;

  constructor(
    accessToken: string,
    graphVersion = process.env.META_GRAPH_VERSION ?? "v24.0"
  ) {
    super();
    this.accessToken = accessToken.trim();
    this.graphVersion = graphVersion;
    if (!this.accessToken) {
      throw new Error("META_ACCESS_TOKEN_REQUIRED");
    }
  }

  protected async graphGet<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const url = this.graphUrl(path);
    assertNoCredentialPayload(params);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    });

    const response = await fetch(url, {
      headers: this.authorizationHeaders(),
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error(`META_GRAPH_REQUEST_FAILED:${response.status}`);
    }
    return (await response.json()) as T;
  }

  protected async graphPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
    assertNoBudgetMutation(body);
    assertNoCredentialPayload(body);
    const url = this.graphUrl(path);
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) {
      if (value === undefined || value === null) {
        continue;
      }
      form.set(key, serializeGraphValue(value));
    }

    const response = await fetch(url, {
      method: "POST",
      headers: this.authorizationHeaders(),
      cache: "no-store",
      body: form
    });
    if (!response.ok) {
      throw new Error(`META_GRAPH_REQUEST_FAILED:${response.status}`);
    }
    return (await response.json()) as T;
  }

  override async listAdAccounts(): Promise<MetaAdAccount[]> {
    const body = await this.graphGet<{
      data?: Array<Record<string, unknown>>;
    }>("me/adaccounts", {
      fields: "id,name,currency,timezone_name"
    });

    return (body.data ?? [])
      .map((row) => ({
        id: readString(row.id),
        name: readString(row.name) ?? "Unnamed Meta account",
        currency: readString(row.currency) ?? "UNKNOWN",
        timezoneName: readString(row.timezone_name) ?? "UTC"
      }))
      .filter((account): account is MetaAdAccount => Boolean(account.id));
  }

  override async getInsights(input: {
    adAccountId: string;
    level?: "account" | "campaign" | "adset" | "ad";
    datePreset?: "today" | "yesterday" | "last_7d" | "last_30d" | "maximum";
    breakdowns?: string[];
  }): Promise<MetaInsight[]> {
    const body = await this.graphGet<{
      data?: Array<Record<string, unknown>>;
    }>(`${input.adAccountId}/insights`, {
      fields:
        "ad_id,campaign_id,adset_id,spend,impressions,reach,frequency,clicks,ctr,cpc,cpm,inline_link_clicks,outbound_clicks,actions,purchase_roas",
      level: input.level ?? "ad",
      date_preset: input.datePreset ?? "last_30d",
      breakdowns: input.breakdowns?.join(",")
    });

    return (body.data ?? []).map((row) => ({
      adId: readString(row.ad_id),
      campaignId: readString(row.campaign_id),
      adsetId: readString(row.adset_id),
      spend: readNumber(row.spend) ?? 0,
      impressions: readNumber(row.impressions) ?? 0,
      reach: readNumber(row.reach) ?? 0,
      frequency: readNumber(row.frequency) ?? 0,
      clicks: readNumber(row.clicks) ?? 0,
      linkClicks: readNumber(row.inline_link_clicks) ?? readActionMetric(row.actions, ["link_click"]) ?? 0,
      outboundClicks: readNumber(row.outbound_clicks) ?? readActionMetric(row.actions, ["outbound_click"]) ?? 0,
      landingPageViews: readActionMetric(row.actions, ["landing_page_view"]) ?? 0,
      purchases: readActionMetric(row.actions, ["purchase", "omni_purchase"]) ?? 0,
      addToCart: readActionMetric(row.actions, ["add_to_cart", "omni_add_to_cart"]) ?? 0,
      ctr: readNumber(row.ctr) ?? 0,
      cpc: readNumber(row.cpc) ?? 0,
      cpm: readNumber(row.cpm) ?? 0,
      purchaseRoas: readRoas(row.purchase_roas),
      breakdowns: readBreakdowns(row, input.breakdowns)
    }));
  }

  override async uploadImage(input: UploadAssetRequest): Promise<{ imageHash: string; status: "PAUSED_READY" }> {
    assertExecutableApproval(input.approval, { ...graphExecutor, tenantId: input.approval.tenantId });
    const sourceUrl = readRequiredSourceUrl(input);
    const body = await this.graphPost<Record<string, unknown>>(`${input.adAccountId}/adimages`, {
      name: buildAssetName("Hermes image", input.asset.id),
      url: sourceUrl
    });
    const imageHash = readImageHash(body);
    if (!imageHash) {
      throw new Error("META_IMAGE_HASH_MISSING");
    }
    return {
      imageHash,
      status: "PAUSED_READY"
    };
  }

  override async uploadVideo(input: UploadAssetRequest): Promise<{ videoId: string; status: "PAUSED_READY" }> {
    assertExecutableApproval(input.approval, { ...graphExecutor, tenantId: input.approval.tenantId });
    const sourceUrl = readRequiredSourceUrl(input);
    const body = await this.graphPost<Record<string, unknown>>(`${input.adAccountId}/advideos`, {
      name: buildAssetName("Hermes video", input.asset.id),
      file_url: sourceUrl
    });
    const videoId = readString(body.id);
    if (!videoId) {
      throw new Error("META_VIDEO_ID_MISSING");
    }
    return {
      videoId,
      status: "PAUSED_READY"
    };
  }

  override async createCreative(input: CreateCreativeRequest): Promise<{ creativeId: string; status: "PAUSED_READY" }> {
    assertExecutableApproval(input.approval, { ...graphExecutor, tenantId: input.approval.tenantId });
    const objectStorySpec = buildObjectStorySpec(input);
    const body = await this.graphPost<Record<string, unknown>>(`${input.adAccountId}/adcreatives`, {
      name: input.name,
      object_story_spec: objectStorySpec
    });
    const creativeId = readString(body.id);
    if (!creativeId) {
      throw new Error("META_CREATIVE_ID_MISSING");
    }
    return {
      creativeId,
      status: "PAUSED_READY"
    };
  }

  override async createCampaignPaused(
    input: CreateCampaignRequest
  ): Promise<{ campaignId: string; status: "PAUSED" }> {
    assertExecutableApproval(input.approval, { ...graphExecutor, tenantId: input.approval.tenantId });
    const body = await this.graphPost<Record<string, unknown>>(`${input.adAccountId}/campaigns`, {
      name: input.name,
      objective: input.objective,
      buying_type: input.buyingType,
      special_ad_categories: input.specialAdCategories ?? [],
      status: "PAUSED"
    });
    const campaignId = readString(body.id);
    if (!campaignId) {
      throw new Error("META_CAMPAIGN_ID_MISSING");
    }
    return {
      campaignId,
      status: "PAUSED"
    };
  }

  override async createAdSetPaused(input: CreateAdSetRequest): Promise<{ adsetId: string; status: "PAUSED" }> {
    assertExecutableApproval(input.approval, { ...graphExecutor, tenantId: input.approval.tenantId });
    assertLiveMetaAdSetInput({
      objective: input.objective ?? "OUTCOME_SALES",
      optimizationGoal: input.optimizationGoal,
      targeting: input.targeting,
      promotedObject: input.promotedObject
    });
    const body = await this.graphPost<Record<string, unknown>>(`${input.adAccountId}/adsets`, {
      name: input.name,
      campaign_id: input.campaignId,
      optimization_goal: input.optimizationGoal,
      targeting: input.targeting,
      billing_event: input.billingEvent,
      bid_strategy: input.bidStrategy,
      promoted_object: input.promotedObject,
      attribution_spec: input.attributionSpec,
      destination_type: input.destinationType,
      start_time: input.startTime,
      end_time: input.endTime,
      status: "PAUSED"
    });
    const adsetId = readString(body.id);
    if (!adsetId) {
      throw new Error("META_ADSET_ID_MISSING");
    }
    return {
      adsetId,
      status: "PAUSED"
    };
  }

  override async createAdPaused(input: CreateAdRequest): Promise<{ adId: string; status: "PAUSED" }> {
    assertExecutableApproval(input.approval, { ...graphExecutor, tenantId: input.approval.tenantId });
    const body = await this.graphPost<Record<string, unknown>>(`${input.adAccountId}/ads`, {
      name: input.name,
      adset_id: input.adsetId,
      creative: {
        creative_id: input.creativeId
      },
      tracking_specs: input.trackingSpecs,
      url_tags: input.urlTags,
      status: "PAUSED"
    });
    const adId = readString(body.id);
    if (!adId) {
      throw new Error("META_AD_ID_MISSING");
    }
    return {
      adId,
      status: "PAUSED"
    };
  }

  private graphUrl(path: string): URL {
    const url = new URL(`https://graph.facebook.com/${this.graphVersion}/${path.replace(/^\//, "")}`);
    assertNoCredentialPayload(Object.fromEntries(url.searchParams.entries()));
    return url;
  }

  private authorizationHeaders(): Record<string, string> {
    return {
      authorization: `Bearer ${this.accessToken}`
    };
  }
}

function buildAssetName(prefix: string, assetId?: string): string {
  return assetId ? `${prefix} ${assetId}` : prefix;
}

function readRequiredSourceUrl(input: UploadAssetRequest): string {
  const sourceUrl = readString(input.sourceUrl);
  if (!sourceUrl) {
    throw new Error("META_ASSET_SOURCE_URL_REQUIRED");
  }
  return sourceUrl;
}

function buildObjectStorySpec(input: CreateCreativeRequest): Record<string, unknown> {
  const pageId = readString(input.pageId);
  if (!pageId) {
    throw new Error("META_PAGE_ID_REQUIRED");
  }

  const callToAction = readCallToAction(input);
  const common = {
    page_id: pageId,
    instagram_actor_id: readString(input.instagramActorId)
  };

  if (input.videoId) {
    const thumbnailUrl = readString(input.thumbnailUrl);
    if (!thumbnailUrl) {
      throw new Error("META_VIDEO_THUMBNAIL_REQUIRED");
    }
    return {
      ...common,
      video_data: {
        video_id: input.videoId,
        image_url: thumbnailUrl,
        link: input.linkUrl,
        message: readString(input.message),
        title: readString(input.headline),
        link_description: readString(input.description),
        call_to_action: callToAction
      }
    };
  }

  if (!input.imageHash && !input.imageUrl) {
    throw new Error("META_IMAGE_SOURCE_REQUIRED");
  }

  return {
    ...common,
    link_data: {
      link: input.linkUrl,
      image_hash: readString(input.imageHash),
      picture: readString(input.imageUrl),
      message: readString(input.message),
      name: readString(input.headline),
      description: readString(input.description),
      call_to_action: callToAction
    }
  };
}

function readCallToAction(input: CreateCreativeRequest): Record<string, unknown> | undefined {
  const type = readString(input.callToActionType);
  if (!type) {
    return undefined;
  }
  return {
    type,
    value: {
      link: input.linkUrl
    }
  };
}

function readImageHash(body: Record<string, unknown>): string | undefined {
  const direct = readString(body.hash);
  if (direct) {
    return direct;
  }

  if (!body.images || typeof body.images !== "object" || Array.isArray(body.images)) {
    return undefined;
  }

  for (const value of Object.values(body.images)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const hash = "hash" in value ? readString(value.hash) : undefined;
    if (hash) {
      return hash;
    }
  }

  return undefined;
}

function serializeGraphValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function readActionMetric(value: unknown, keys: string[]): number | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const actionType = "action_type" in item ? readString(item.action_type) : undefined;
    if (!actionType || !keys.includes(actionType)) {
      continue;
    }

    const metric = "value" in item ? readNumber(item.value) : undefined;
    if (metric !== undefined) {
      return metric;
    }
  }

  return undefined;
}

function readBreakdowns(row: Record<string, unknown>, keys?: string[]): Record<string, string> | undefined {
  if (!keys || keys.length === 0) {
    return undefined;
  }

  const breakdowns = Object.fromEntries(
    keys.flatMap((key) => {
      const value = readString(row[key]);
      return value ? [[key, value]] : [];
    })
  );

  return Object.keys(breakdowns).length > 0 ? breakdowns : undefined;
}

function readRoas(value: unknown): number | undefined {
  if (typeof value === "number" || typeof value === "string") {
    return readNumber(value);
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  for (const item of value) {
    if (!item || typeof item !== "object" || !("value" in item)) {
      continue;
    }
    const parsed = readNumber(item.value);
    if (parsed !== undefined) {
      return parsed;
    }
  }

  return undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
