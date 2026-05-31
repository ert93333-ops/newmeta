import type {
  ApprovalRequest,
  CreativeAssetMetadata,
  MetaAd,
  MetaAdAccount,
  MetaAdSet,
  MetaCampaign,
  MetaInsight,
  Placement
} from "@/lib/types";

export interface MetaAdapter {
  listAdAccounts(): Promise<MetaAdAccount[]>;
  listCampaigns(adAccountId: string): Promise<MetaCampaign[]>;
  listAdSets(adAccountId: string, campaignId?: string): Promise<MetaAdSet[]>;
  listAds(adAccountId: string, adsetId?: string): Promise<MetaAd[]>;
  getInsights(input: InsightsRequest): Promise<MetaInsight[]>;
  getCreative(creativeId: string): Promise<unknown>;
  getAdImages(adAccountId: string): Promise<unknown[]>;
  getAdVideos(adAccountId: string): Promise<unknown[]>;
  uploadImage(input: UploadAssetRequest): Promise<{ imageHash: string; status: "PAUSED_READY" }>;
  uploadVideo(input: UploadAssetRequest): Promise<{ videoId: string; status: "PAUSED_READY" }>;
  createCreative(input: CreateCreativeRequest): Promise<{ creativeId: string; status: "PAUSED_READY" }>;
  createCampaignPaused(input: CreateCampaignRequest): Promise<{ campaignId: string; status: "PAUSED" }>;
  createAdSetPaused(input: CreateAdSetRequest): Promise<{ adsetId: string; status: "PAUSED" }>;
  createAdPaused(input: CreateAdRequest): Promise<{ adId: string; status: "PAUSED" }>;
  updateStatusWithApproval(input: UpdateStatusRequest): Promise<{ id: string; status: "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED" }>;
  validatePlacementCompatibility(input: PlacementCompatibilityRequest): Promise<unknown>;
  getPixelDiagnostics(adAccountId: string): Promise<unknown>;
  getSignalDiagnostics(adAccountId: string): Promise<unknown>;
}

export interface InsightsRequest {
  adAccountId: string;
  level?: "account" | "campaign" | "adset" | "ad";
  datePreset?: "today" | "yesterday" | "last_7d" | "last_30d" | "maximum";
  breakdowns?: string[];
}

export interface UploadAssetRequest {
  adAccountId: string;
  asset: CreativeAssetMetadata;
  approval: ApprovalRequest;
}

export interface CreateCreativeRequest {
  adAccountId: string;
  name: string;
  pageId: string;
  instagramActorId?: string;
  linkUrl: string;
  imageHash?: string;
  videoId?: string;
  approval: ApprovalRequest;
}

export interface CreateCampaignRequest {
  adAccountId: string;
  name: string;
  objective: string;
  approval: ApprovalRequest;
}

export interface CreateAdSetRequest {
  adAccountId: string;
  campaignId: string;
  name: string;
  optimizationGoal: string;
  targeting: Record<string, unknown>;
  approval: ApprovalRequest;
}

export interface CreateAdRequest {
  adAccountId: string;
  adsetId: string;
  name: string;
  creativeId: string;
  approval: ApprovalRequest;
}

export interface UpdateStatusRequest {
  objectId: string;
  objectType: "campaign" | "adset" | "ad";
  status: "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED";
  approval: ApprovalRequest;
}

export interface PlacementCompatibilityRequest {
  asset: CreativeAssetMetadata;
  placements: Placement[];
  objective?: string;
  creativeType?: string;
}
