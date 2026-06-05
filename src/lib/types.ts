export const USER_ROLES = ["owner", "admin", "marketer", "analyst", "viewer"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const RISK_LEVELS = ["read", "draft", "publish", "destructive", "hard_blocked"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const APPROVAL_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "expired",
  "executed",
  "cancelled"
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const JOB_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export type Placement =
  | "facebook_feed"
  | "instagram_feed"
  | "facebook_stories"
  | "instagram_stories"
  | "instagram_reels"
  | "facebook_reels"
  | "audience_network"
  | "messenger_inbox"
  | "right_column"
  | "instream_video";

export type CreativeAssetType = "image" | "video";

export interface TenantScoped {
  id: string;
  tenantId: string;
  createdAt: string;
  createdBy?: string;
}

export interface UserContext {
  userId: string;
  tenantId: string;
  role: UserRole;
  email?: string;
}

export interface ApprovalRequest extends TenantScoped {
  action: ApprovalAction;
  riskLevel: RiskLevel;
  objectType: string;
  objectId?: string;
  status: ApprovalStatus;
  beforeJson?: unknown;
  afterJson?: unknown;
  diffJson?: unknown;
  reason?: string;
  requiresSecondApproval: boolean;
  requestedBy: string;
  approvedBy?: string;
  secondApprovedBy?: string;
  executionResultJson?: unknown;
  expiresAt?: string;
}

export type ApprovalAction =
  | "meta_upload_image"
  | "meta_upload_video"
  | "meta_create_creative"
  | "meta_create_campaign_paused"
  | "meta_create_adset_paused"
  | "meta_create_ad_paused"
  | "meta_activate_campaign"
  | "meta_activate_adset"
  | "meta_activate_ad"
  | "meta_pause_ad"
  | "meta_delete_ad"
  | "meta_disconnect_connection"
  | "meta_change_targeting"
  | "meta_replace_creative"
  | "catalog_mutation"
  | "tenant_data_deletion"
  | "ai_paid_generation";

export interface MetaAdAccount {
  id: string;
  name: string;
  currency: string;
  timezoneName: string;
}

export interface MetaCampaign {
  id: string;
  name: string;
  objective: string;
  status: "ACTIVE" | "PAUSED" | "ARCHIVED" | "DELETED";
}

export interface MetaAdSet {
  id: string;
  campaignId: string;
  name: string;
  optimizationGoal: string;
  status: "ACTIVE" | "PAUSED" | "ARCHIVED" | "DELETED";
}

export interface MetaAd {
  id: string;
  adsetId: string;
  creativeId: string;
  name: string;
  status: "ACTIVE" | "PAUSED" | "ARCHIVED" | "DELETED";
}

export interface MetaInsight {
  adId?: string;
  campaignId?: string;
  adsetId?: string;
  spend: number;
  impressions: number;
  reach: number;
  frequency: number;
  clicks: number;
  linkClicks: number;
  outboundClicks: number;
  landingPageViews: number;
  purchases: number;
  addToCart: number;
  ctr: number;
  cpc: number;
  cpm: number;
  purchaseRoas?: number;
  breakdowns?: Record<string, string>;
}

export interface CreativeAssetMetadata {
  id?: string;
  type: CreativeAssetType;
  width: number;
  height: number;
  fileSizeBytes?: number;
  durationSeconds?: number;
  mimeType?: string;
}

export interface TextBox {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  role?: "hook" | "headline" | "subheadline" | "price" | "cta" | "usp";
}

export interface CreativeManifest {
  asset: CreativeAssetMetadata;
  textBoxes: TextBox[];
  declaredPrice?: string;
  primaryText?: string;
  headline?: string;
  description?: string;
  linkUrl?: string;
  placements?: Placement[];
}

export interface Score {
  name: string;
  value: number;
  evidence: string[];
}

export interface CostSettings {
  providerName: string;
  planName?: string;
  monthlyPlanPriceKrw?: number;
  monthlyCredits?: number;
  creditUnitCostKrw?: number;
  imageGenerationCreditCost?: number;
  videoGenerationCreditCost?: number;
  analysisCreditCost?: number;
  dailyCostCapKrw?: number;
  monthlyCostCapKrw?: number;
  hardDailyCapKrw?: number;
  referenceDailyAdBudgetKrw?: number;
  exchangeRate?: number;
}

export interface CostEstimateInput {
  operationType:
    | "cached_analysis"
    | "ocr_safezone_check"
    | "image_analysis"
    | "image_generation"
    | "video_analysis"
    | "video_generation"
    | "variant_batch";
  units?: number;
  model?: string;
  estimatedCredits?: number;
  settings: CostSettings;
  todayActualCostKrw?: number;
  monthActualCostKrw?: number;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
