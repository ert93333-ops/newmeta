import { randomUUID } from "node:crypto";
import { assertExecutableApproval } from "@/lib/approval/approval-policy";
import type { MetaAdapter, PlacementCompatibilityRequest, UpdateStatusRequest } from "@/lib/meta/meta-adapter";
import type { MetaAd, MetaAdAccount, MetaAdSet, MetaCampaign, MetaInsight, UserContext } from "@/lib/types";
import { validatePlacement } from "@/lib/placement/placement-validator";

const systemExecutor: UserContext = {
  userId: "00000000-0000-0000-0000-000000000000",
  tenantId: "00000000-0000-0000-0000-000000000001",
  role: "owner"
};

export class MockMetaAdapter implements MetaAdapter {
  async listAdAccounts(): Promise<MetaAdAccount[]> {
    return [
      {
        id: "act_mock_001",
        name: "Mock DTC Store",
        currency: "KRW",
        timezoneName: "Asia/Seoul"
      }
    ];
  }

  async listCampaigns(_adAccountId: string): Promise<MetaCampaign[]> {
    return [
      {
        id: "cmp_mock_hook",
        name: "Hook Test Campaign",
        objective: "OUTCOME_SALES",
        status: "PAUSED"
      }
    ];
  }

  async listAdSets(_adAccountId: string, campaignId = "cmp_mock_hook"): Promise<MetaAdSet[]> {
    return [
      {
        id: "adset_mock_001",
        campaignId,
        name: "Broad 25-44",
        optimizationGoal: "OFFSITE_CONVERSIONS",
        status: "PAUSED"
      }
    ];
  }

  async listAds(_adAccountId: string, adsetId = "adset_mock_001"): Promise<MetaAd[]> {
    return [
      {
        id: "ad_mock_001",
        adsetId,
        creativeId: "creative_mock_001",
        name: "4:5 product hook",
        status: "PAUSED"
      }
    ];
  }

  async getInsights(_input?: unknown): Promise<MetaInsight[]> {
    return [
      {
        adId: "ad_mock_001",
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
          publisher_platform: "instagram",
          platform_position: "feed"
        }
      }
    ];
  }

  async getCreative(creativeId: string): Promise<unknown> {
    return {
      id: creativeId,
      object_story_spec: {
        page_id: "page_mock_001"
      }
    };
  }

  async getAdImages(): Promise<unknown[]> {
    return [{ hash: "mock_image_hash", width: 1080, height: 1350 }];
  }

  async getAdVideos(): Promise<unknown[]> {
    return [{ id: "mock_video_id", width: 1080, height: 1920, duration: 12 }];
  }

  async validateCampaignCreate(_input: Parameters<MetaAdapter["validateCampaignCreate"]>[0]): Promise<void> {
    return;
  }

  async validateAdSetCreate(_input: Parameters<MetaAdapter["validateAdSetCreate"]>[0]): Promise<void> {
    return;
  }

  async uploadImage(input: Parameters<MetaAdapter["uploadImage"]>[0]): Promise<{ imageHash: string; status: "PAUSED_READY" }> {
    assertExecutableApproval(input.approval, { ...systemExecutor, tenantId: input.approval.tenantId });
    return { imageHash: `mock_hash_${randomUUID()}`, status: "PAUSED_READY" };
  }

  async uploadVideo(input: Parameters<MetaAdapter["uploadVideo"]>[0]): Promise<{ videoId: string; status: "PAUSED_READY" }> {
    assertExecutableApproval(input.approval, { ...systemExecutor, tenantId: input.approval.tenantId });
    return { videoId: `mock_video_${randomUUID()}`, status: "PAUSED_READY" };
  }

  async createCreative(input: Parameters<MetaAdapter["createCreative"]>[0]): Promise<{ creativeId: string; status: "PAUSED_READY" }> {
    assertExecutableApproval(input.approval, { ...systemExecutor, tenantId: input.approval.tenantId });
    return { creativeId: `creative_${randomUUID()}`, status: "PAUSED_READY" };
  }

  async createCampaignPaused(input: Parameters<MetaAdapter["createCampaignPaused"]>[0]): Promise<{ campaignId: string; status: "PAUSED" }> {
    assertExecutableApproval(input.approval, { ...systemExecutor, tenantId: input.approval.tenantId });
    return { campaignId: `cmp_${randomUUID()}`, status: "PAUSED" };
  }

  async createAdSetPaused(input: Parameters<MetaAdapter["createAdSetPaused"]>[0]): Promise<{ adsetId: string; status: "PAUSED" }> {
    assertExecutableApproval(input.approval, { ...systemExecutor, tenantId: input.approval.tenantId });
    return { adsetId: `adset_${randomUUID()}`, status: "PAUSED" };
  }

  async createAdPaused(input: Parameters<MetaAdapter["createAdPaused"]>[0]): Promise<{ adId: string; status: "PAUSED" }> {
    assertExecutableApproval(input.approval, { ...systemExecutor, tenantId: input.approval.tenantId });
    return { adId: `ad_${randomUUID()}`, status: "PAUSED" };
  }

  async updateStatusWithApproval(input: UpdateStatusRequest): Promise<{ id: string; status: "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED" }> {
    assertExecutableApproval(input.approval, { ...systemExecutor, tenantId: input.approval.tenantId });
    return { id: input.objectId, status: input.status };
  }

  async validatePlacementCompatibility(input: PlacementCompatibilityRequest): Promise<unknown> {
    return validatePlacement(input);
  }

  async getPixelDiagnostics(adAccountId: string): Promise<unknown> {
    return {
      adAccountId,
      status: "mock_ok",
      warnings: []
    };
  }

  async getSignalDiagnostics(adAccountId: string): Promise<unknown> {
    return {
      adAccountId,
      pixel: "mock_ok",
      capi: "mock_not_configured",
      ga4: "mock_not_configured"
    };
  }
}
