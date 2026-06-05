import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as syncInsights } from "@/app/api/meta/sync/insights/route";
import { MemoryHermesRepository } from "@/lib/repositories/hermes-repository";
import { encryptToken } from "@/lib/security/token-crypto";
import type { UserContext } from "@/lib/types";

const { mockResolveUserContext } = vi.hoisted(() => ({
  mockResolveUserContext: vi.fn()
}));

vi.mock("@/lib/api/context", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/context")>("@/lib/api/context");
  return {
    ...actual,
    resolveUserContext: mockResolveUserContext
  };
});

const context: UserContext = {
  userId: "meta-sync-user",
  tenantId: "tenant-meta-sync",
  role: "marketer"
};

const ENV_KEYS = [
  "NODE_ENV",
  "VERCEL_ENV",
  "TOKEN_ENCRYPTION_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
] as const;
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const mutableEnv = process.env as unknown as Record<string, string | undefined>;

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = ORIGINAL_ENV[key];
    if (value === undefined) {
      delete mutableEnv[key];
    } else {
      mutableEnv[key] = value;
    }
  }
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("Meta insights sync route", () => {
  afterEach(() => {
    mockResolveUserContext.mockReset();
    restoreEnv();
    vi.unstubAllGlobals();
  });

  it("uses the mock adapter locally when no Meta connection exists", async () => {
    delete mutableEnv.NODE_ENV;
    delete mutableEnv.VERCEL_ENV;
    delete mutableEnv.NEXT_PUBLIC_SUPABASE_URL;
    delete mutableEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    mockResolveUserContext.mockResolvedValue(context);

    const response = await syncInsights(
      new Request("http://localhost/api/meta/sync/insights", {
        method: "POST",
        body: JSON.stringify({})
      })
    );
    const body = await json(response);

    expect(response.status).toBe(201);
    expect(body.input).toMatchObject({
      adAccountId: "act_mock_001",
      adapterMode: "mock",
      level: "ad",
      datePreset: "last_30d"
    });
    expect(body.result).toEqual([
      expect.objectContaining({
        adId: "ad_mock_001"
      })
    ]);
  });

  it("requires an explicit ad account id for live insights sync", async () => {
    mutableEnv.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString("base64");
    delete mutableEnv.NEXT_PUBLIC_SUPABASE_URL;
    delete mutableEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    mockResolveUserContext.mockResolvedValue(context);
    const encrypted = encryptToken("server-token", mutableEnv.TOKEN_ENCRYPTION_KEY, "primary");
    await new MemoryHermesRepository().saveMetaConnection(new Request("http://localhost/api/test"), {
      id: "meta-live-connection-sync",
      tenantId: context.tenantId,
      createdBy: context.userId,
      provider: "meta",
      connectionMode: "oauth",
      encryptedAccessToken: encrypted.encryptedAccessToken,
      tokenIv: encrypted.tokenIv,
      tokenAuthTag: encrypted.tokenAuthTag,
      tokenKid: encrypted.tokenKid,
      scopes: ["ads_read"],
      status: "connected",
      metadataJson: {
        mode: "live"
      }
    });

    const response = await syncInsights(
      new Request("http://localhost/api/meta/sync/insights", {
        method: "POST",
        body: JSON.stringify({})
      })
    );
    const body = await json(response);

    expect(response.status).toBe(400);
    expect((body.error as { code?: string }).code).toBe("META_AD_ACCOUNT_REQUIRED");
  });

  it("uses the stored live Meta connection to sync real insights server-side", async () => {
    delete mutableEnv.NODE_ENV;
    delete mutableEnv.VERCEL_ENV;
    delete mutableEnv.NEXT_PUBLIC_SUPABASE_URL;
    delete mutableEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    mutableEnv.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    mockResolveUserContext.mockResolvedValue(context);
    const encrypted = encryptToken("server-token", mutableEnv.TOKEN_ENCRYPTION_KEY, "primary");
    await new MemoryHermesRepository().saveMetaConnection(new Request("http://localhost/api/test"), {
      id: "meta-live-connection-sync-live",
      tenantId: context.tenantId,
      createdBy: context.userId,
      provider: "meta",
      connectionMode: "oauth",
      encryptedAccessToken: encrypted.encryptedAccessToken,
      tokenIv: encrypted.tokenIv,
      tokenAuthTag: encrypted.tokenAuthTag,
      tokenKid: encrypted.tokenKid,
      scopes: ["ads_read"],
      status: "connected",
      metadataJson: {
        mode: "live"
      }
    });
    const fetchMock = vi.fn(async () =>
      Response.json({
        data: [
          {
            ad_id: "ad_live_1",
            campaign_id: "cmp_live_1",
            adset_id: "adset_live_1",
            spend: "42000",
            impressions: "3200",
            reach: "2500",
            frequency: "1.28",
            clicks: "82",
            inline_link_clicks: "55",
            outbound_clicks: "49",
            ctr: "2.56",
            cpc: "512",
            cpm: "13125",
            purchase_roas: [{ value: "1.6" }],
            actions: [
              { action_type: "landing_page_view", value: "37" },
              { action_type: "purchase", value: "2" },
              { action_type: "add_to_cart", value: "7" }
            ],
            publisher_platform: "instagram"
          }
        ]
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await syncInsights(
      new Request("http://localhost/api/meta/sync/insights", {
        method: "POST",
        body: JSON.stringify({
          adAccountId: "act_live_123",
          breakdowns: ["publisher_platform"],
          datePreset: "last_7d"
        })
      })
    );
    const body = await json(response);

    expect(response.status).toBe(201);
    expect(body.input).toMatchObject({
      adAccountId: "act_live_123",
      adapterMode: "live",
      breakdowns: ["publisher_platform"],
      datePreset: "last_7d"
    });
    expect(body.result).toEqual([
      {
        adId: "ad_live_1",
        campaignId: "cmp_live_1",
        adsetId: "adset_live_1",
        spend: 42000,
        impressions: 3200,
        reach: 2500,
        frequency: 1.28,
        clicks: 82,
        linkClicks: 55,
        outboundClicks: 49,
        landingPageViews: 37,
        purchases: 2,
        addToCart: 7,
        ctr: 2.56,
        cpc: 512,
        cpm: 13125,
        purchaseRoas: 1.6,
        breakdowns: {
          publisher_platform: "instagram"
        }
      }
    ]);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toContain("act_live_123/insights");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer server-token");
    expect(JSON.stringify(body)).not.toContain("server-token");
  });
});
