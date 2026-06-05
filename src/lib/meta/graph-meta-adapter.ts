import { assertNoBudgetMutation } from "@/lib/guards/budget-guard";
import { assertNoCredentialPayload } from "@/lib/guards/credential-guard";
import type { MetaAdapter } from "@/lib/meta/meta-adapter";
import { MockMetaAdapter } from "@/lib/meta/mock-meta-adapter";
import type { MetaAdAccount, MetaInsight } from "@/lib/types";

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
    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...this.authorizationHeaders(),
        "content-type": "application/json"
      },
      cache: "no-store",
      body: JSON.stringify(body)
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
