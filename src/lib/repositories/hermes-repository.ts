import type { ApprovalRequest, CostEstimateInput, UserContext } from "@/lib/types";
import { estimateOperationCredits } from "@/lib/guards/cost-guard";
import { redactCredentialPayload } from "@/lib/guards/credential-guard";
import { createSupabaseClient, getBearerAuthorization, hasSupabaseConfig } from "@/lib/supabase/server";

export interface AuditLogInput {
  tenantId: string;
  userId: string;
  action: string;
  objectType: string;
  objectId?: string;
  approvalRequestId?: string;
  beforeJson?: unknown;
  afterJson?: unknown;
  result?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface CostUsageInput {
  tenantId: string;
  userId: string;
  provider: string;
  model?: string;
  operationType: string;
  estimatedCredits: number;
  actualCredits?: number;
  estimatedCostKrw: number;
  actualCostKrw?: number;
  relatedAssetId?: string;
  relatedJobId?: string;
  status: string;
  createdAt?: string;
}

export interface CostUsageSummary {
  todayActualCostKrw: number;
  monthActualCostKrw: number;
}

export interface MetaConnectionInput {
  id: string;
  tenantId: string;
  createdBy: string;
  provider: string;
  connectionMode: string;
  encryptedAccessToken: string;
  tokenIv: string;
  tokenAuthTag: string;
  tokenKid: string;
  scopes: string[];
  expiresAt?: string;
  status: string;
  metadataJson?: unknown;
}

export interface MetaConnectionRecord extends MetaConnectionInput {
  createdAt?: string;
}

export interface IntegrationSettingsRecord {
  id?: string;
  tenantId: string;
  createdBy?: string;
  provider: string;
  settingsJson: unknown;
  createdAt?: string;
  updatedAt?: string;
}

export interface AdDraftRecord {
  id?: string;
  tenantId: string;
  createdBy?: string;
  adAccountId?: string;
  assetId?: string;
  approvalRequestId?: string;
  metaCampaignId?: string;
  metaAdsetId?: string;
  metaAdId?: string;
  draftType: string;
  metaStatus: "PAUSED" | "ACTIVE" | "ARCHIVED" | "DELETED";
  preflightJson: unknown;
  payloadJson: unknown;
  createdAt?: string;
  updatedAt?: string;
}

export interface PerformanceFusionReportRecord {
  id?: string;
  tenantId: string;
  createdBy?: string;
  assetId?: string;
  bottleneckJobId?: string;
  reportJson: unknown;
  languageGuard: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PlacementValidationReportRecord {
  id?: string;
  tenantId: string;
  createdBy?: string;
  assetId?: string;
  placements: string[];
  status: string;
  error1487569Risk: boolean;
  reportJson: unknown;
  createdAt?: string;
  updatedAt?: string;
}

export interface HermesRepository {
  saveApproval(request: Request, approval: ApprovalRequest): Promise<ApprovalRequest>;
  getApproval(request: Request, context: UserContext, id: string): Promise<ApprovalRequest | null>;
  listApprovals(request: Request, context: UserContext, limit?: number): Promise<ApprovalRequest[]>;
  updateApproval(request: Request, approval: ApprovalRequest): Promise<ApprovalRequest>;
  saveAuditLog(request: Request, audit: AuditLogInput): Promise<void>;
  saveCostUsage(request: Request, usage: CostUsageInput): Promise<void>;
  listCostUsage(request: Request, context: UserContext): Promise<unknown[]>;
  summarizeCostUsage(request: Request, context: UserContext, now?: Date): Promise<CostUsageSummary>;
  saveJob(request: Request, job: Record<string, unknown>): Promise<Record<string, unknown>>;
  getJob(request: Request, context: UserContext, id: string): Promise<Record<string, unknown> | null>;
  saveAsset(request: Request, asset: Record<string, unknown>): Promise<Record<string, unknown>>;
  saveMetaConnection(request: Request, connection: MetaConnectionInput): Promise<MetaConnectionInput>;
  getLatestMetaConnection(request: Request, context: UserContext, provider: string): Promise<MetaConnectionRecord | null>;
  getIntegrationSettings(
    request: Request,
    context: UserContext,
    provider: string
  ): Promise<IntegrationSettingsRecord | null>;
  saveIntegrationSettings(request: Request, settings: IntegrationSettingsRecord): Promise<IntegrationSettingsRecord>;
  saveAdDraft(request: Request, draft: AdDraftRecord): Promise<AdDraftRecord>;
  getAdDraft(request: Request, context: UserContext, id: string): Promise<AdDraftRecord | null>;
  savePerformanceFusionReport(
    request: Request,
    report: PerformanceFusionReportRecord
  ): Promise<PerformanceFusionReportRecord>;
  getPerformanceFusionReport(
    request: Request,
    context: UserContext,
    id: string
  ): Promise<PerformanceFusionReportRecord | null>;
  savePlacementValidationReport(
    request: Request,
    report: PlacementValidationReportRecord
  ): Promise<PlacementValidationReportRecord>;
  getPlacementValidationReport(
    request: Request,
    context: UserContext,
    id: string
  ): Promise<PlacementValidationReportRecord | null>;
}

interface HermesMemoryStore {
  approvals: Map<string, ApprovalRequest>;
  jobs: Map<string, Record<string, unknown>>;
  assets: Map<string, Record<string, unknown>>;
  adDrafts: Map<string, AdDraftRecord>;
  performanceFusionReports: Map<string, PerformanceFusionReportRecord>;
  placementValidationReports: Map<string, PlacementValidationReportRecord>;
  metaConnections: Map<string, MetaConnectionInput>;
  integrationSettings: Map<string, IntegrationSettingsRecord>;
  costUsage: unknown[];
  auditLogs: AuditLogInput[];
}

const globalStore = globalThis as typeof globalThis & { __hermesRepositoryStore?: HermesMemoryStore };

function getMemoryStore(): HermesMemoryStore {
  if (!globalStore.__hermesRepositoryStore) {
    globalStore.__hermesRepositoryStore = {
      approvals: new Map(),
      jobs: new Map(),
      assets: new Map(),
      adDrafts: new Map(),
      performanceFusionReports: new Map(),
      placementValidationReports: new Map(),
      metaConnections: new Map(),
      integrationSettings: new Map(),
      costUsage: [],
      auditLogs: []
    };
  }
  return globalStore.__hermesRepositoryStore;
}

export function getRepository(): HermesRepository {
  if (hasSupabaseConfig("user")) {
    return new SupabaseHermesRepository(new MemoryHermesRepository());
  }
  return new MemoryHermesRepository();
}

export class MemoryHermesRepository implements HermesRepository {
  async saveApproval(_request: Request, approval: ApprovalRequest): Promise<ApprovalRequest> {
    getMemoryStore().approvals.set(approval.id, approval);
    return approval;
  }

  async getApproval(_request: Request, context: UserContext, id: string): Promise<ApprovalRequest | null> {
    const approval = getMemoryStore().approvals.get(id);
    if (!approval || approval.tenantId !== context.tenantId) {
      return null;
    }
    return approval;
  }

  async listApprovals(_request: Request, context: UserContext, limit = 50): Promise<ApprovalRequest[]> {
    return Array.from(getMemoryStore().approvals.values())
      .filter((approval) => approval.tenantId === context.tenantId)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, limit);
  }

  async updateApproval(_request: Request, approval: ApprovalRequest): Promise<ApprovalRequest> {
    getMemoryStore().approvals.set(approval.id, approval);
    return approval;
  }

  async saveAuditLog(request: Request, audit: AuditLogInput): Promise<void> {
    getMemoryStore().auditLogs.push(withRequestAuditMetadata(request, audit));
  }

  async saveCostUsage(_request: Request, usage: CostUsageInput): Promise<void> {
    getMemoryStore().costUsage.push({
      ...usage,
      createdAt: usage.createdAt ?? new Date().toISOString()
    });
  }

  async listCostUsage(_request: Request, context: UserContext): Promise<unknown[]> {
    return getMemoryStore().costUsage.filter((item) => {
      return typeof item === "object" && item !== null && "tenantId" in item && item.tenantId === context.tenantId;
    });
  }

  async summarizeCostUsage(_request: Request, context: UserContext, now = new Date()): Promise<CostUsageSummary> {
    return summarizeCostUsageRows(await this.listCostUsage(_request, context), now);
  }

  async saveJob(_request: Request, job: Record<string, unknown>): Promise<Record<string, unknown>> {
    getMemoryStore().jobs.set(String(job.id), job);
    return job;
  }

  async getJob(_request: Request, context: UserContext, id: string): Promise<Record<string, unknown> | null> {
    const job = getMemoryStore().jobs.get(id);
    if (!job || job.tenantId !== context.tenantId) {
      return null;
    }
    return job;
  }

  async saveAsset(_request: Request, asset: Record<string, unknown>): Promise<Record<string, unknown>> {
    getMemoryStore().assets.set(String(asset.id), asset);
    return asset;
  }

  async saveMetaConnection(_request: Request, connection: MetaConnectionInput): Promise<MetaConnectionInput> {
    getMemoryStore().metaConnections.set(connection.id, connection);
    return connection;
  }

  async getLatestMetaConnection(
    _request: Request,
    context: UserContext,
    provider: string
  ): Promise<MetaConnectionRecord | null> {
    const matches = Array.from(getMemoryStore().metaConnections.values()).filter((connection) => {
      return connection.tenantId === context.tenantId && connection.provider === provider && connection.status === "connected";
    });

    return matches.at(-1) ?? null;
  }

  async getIntegrationSettings(
    _request: Request,
    context: UserContext,
    provider: string
  ): Promise<IntegrationSettingsRecord | null> {
    const setting = getMemoryStore().integrationSettings.get(settingKey(context.tenantId, provider));
    return setting ?? null;
  }

  async saveIntegrationSettings(_request: Request, settings: IntegrationSettingsRecord): Promise<IntegrationSettingsRecord> {
    const now = new Date().toISOString();
    const persisted = {
      ...settings,
      id: settings.id ?? crypto.randomUUID(),
      createdAt: settings.createdAt || now,
      updatedAt: now
    };
    getMemoryStore().integrationSettings.set(settingKey(settings.tenantId, settings.provider), persisted);
    return persisted;
  }

  async saveAdDraft(_request: Request, draft: AdDraftRecord): Promise<AdDraftRecord> {
    const now = new Date().toISOString();
    const persisted = {
      ...draft,
      id: draft.id ?? crypto.randomUUID(),
      createdAt: draft.createdAt ?? now,
      updatedAt: now
    };
    getMemoryStore().adDrafts.set(persisted.id, persisted);
    return persisted;
  }

  async getAdDraft(_request: Request, context: UserContext, id: string): Promise<AdDraftRecord | null> {
    const draft = getMemoryStore().adDrafts.get(id);
    if (!draft || draft.tenantId !== context.tenantId) {
      return null;
    }
    return draft;
  }

  async savePerformanceFusionReport(
    _request: Request,
    report: PerformanceFusionReportRecord
  ): Promise<PerformanceFusionReportRecord> {
    const now = new Date().toISOString();
    const persisted = {
      ...report,
      id: report.id ?? crypto.randomUUID(),
      createdAt: report.createdAt ?? now,
      updatedAt: now
    };
    getMemoryStore().performanceFusionReports.set(persisted.id, persisted);
    return persisted;
  }

  async getPerformanceFusionReport(
    _request: Request,
    context: UserContext,
    id: string
  ): Promise<PerformanceFusionReportRecord | null> {
    const report = getMemoryStore().performanceFusionReports.get(id);
    if (!report || report.tenantId !== context.tenantId) {
      return null;
    }
    return report;
  }

  async savePlacementValidationReport(
    _request: Request,
    report: PlacementValidationReportRecord
  ): Promise<PlacementValidationReportRecord> {
    const now = new Date().toISOString();
    const persisted = {
      ...report,
      id: report.id ?? crypto.randomUUID(),
      createdAt: report.createdAt ?? now,
      updatedAt: now
    };
    getMemoryStore().placementValidationReports.set(persisted.id, persisted);
    return persisted;
  }

  async getPlacementValidationReport(
    _request: Request,
    context: UserContext,
    id: string
  ): Promise<PlacementValidationReportRecord | null> {
    const report = getMemoryStore().placementValidationReports.get(id);
    if (!report || report.tenantId !== context.tenantId) {
      return null;
    }
    return report;
  }
}

export class SupabaseHermesRepository implements HermesRepository {
  constructor(private readonly fallback: HermesRepository) {}

  async saveApproval(request: Request, approval: ApprovalRequest): Promise<ApprovalRequest> {
    const supabase = createRequestClient(request);
    if (!supabase) return this.fallback.saveApproval(request, approval);

    const { error } = await supabase.from("approval_requests").insert(toApprovalRow(approval));
    if (error) throw new Error(`SUPABASE_APPROVAL_INSERT_FAILED:${error.message}`);
    return approval;
  }

  async getApproval(request: Request, context: UserContext, id: string): Promise<ApprovalRequest | null> {
    const supabase = createRequestClient(request);
    if (!supabase) return this.fallback.getApproval(request, context, id);

    const { data, error } = await supabase
      .from("approval_requests")
      .select("*")
      .eq("id", id)
      .eq("tenant_id", context.tenantId)
      .maybeSingle();
    if (error) throw new Error(`SUPABASE_APPROVAL_SELECT_FAILED:${error.message}`);
    return data ? fromApprovalRow(data as ApprovalRow) : null;
  }

  async listApprovals(request: Request, context: UserContext, limit = 50): Promise<ApprovalRequest[]> {
    const supabase = createRequestClient(request);
    if (!supabase) return this.fallback.listApprovals(request, context, limit);

    const { data, error } = await supabase
      .from("approval_requests")
      .select("*")
      .eq("tenant_id", context.tenantId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`SUPABASE_APPROVAL_LIST_FAILED:${error.message}`);
    return (data ?? []).map((row) => fromApprovalRow(row as ApprovalRow));
  }

  async updateApproval(request: Request, approval: ApprovalRequest): Promise<ApprovalRequest> {
    const supabase = createRequestClient(request);
    if (!supabase) return this.fallback.updateApproval(request, approval);

    const { data, error } = await supabase
      .from("approval_requests")
      .update(toApprovalRow(approval))
      .eq("id", approval.id)
      .eq("tenant_id", approval.tenantId)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(`SUPABASE_APPROVAL_UPDATE_FAILED:${error.message}`);
    if (!data) throw new Error("SUPABASE_APPROVAL_UPDATE_MISSED");
    return fromApprovalRow(data as ApprovalRow);
  }

  async saveAuditLog(request: Request, audit: AuditLogInput): Promise<void> {
    const supabase = createRequestClient(request);
    if (!supabase) return this.fallback.saveAuditLog(request, audit);
    const enrichedAudit = withRequestAuditMetadata(request, audit);

    const { error } = await supabase.from("audit_logs").insert({
      tenant_id: enrichedAudit.tenantId,
      created_by: enrichedAudit.userId,
      user_id: enrichedAudit.userId,
      action: enrichedAudit.action,
      object_type: enrichedAudit.objectType,
      object_id: enrichedAudit.objectId,
      approval_request_id: enrichedAudit.approvalRequestId,
      before_json: enrichedAudit.beforeJson ?? {},
      after_json: enrichedAudit.afterJson ?? {},
      ip_address: enrichedAudit.ipAddress,
      user_agent: enrichedAudit.userAgent,
      result: enrichedAudit.result ?? "recorded"
    });
    if (error) throw new Error(`SUPABASE_AUDIT_INSERT_FAILED:${error.message}`);
  }

  async saveCostUsage(request: Request, usage: CostUsageInput): Promise<void> {
    const supabase = createRequestClient(request);
    if (!supabase) return this.fallback.saveCostUsage(request, usage);

    const row: Record<string, unknown> = {
      tenant_id: usage.tenantId,
      created_by: usage.userId,
      provider: usage.provider,
      model: usage.model,
      operation_type: usage.operationType,
      estimated_credits: usage.estimatedCredits,
      actual_credits: usage.actualCredits,
      estimated_cost_krw: usage.estimatedCostKrw,
      actual_cost_krw: usage.actualCostKrw,
      related_asset_id: usage.relatedAssetId,
      related_job_id: usage.relatedJobId,
      status: usage.status
    };
    if (usage.createdAt) {
      row.created_at = usage.createdAt;
    }

    const { error } = await supabase.from("cost_usage_logs").insert(row);
    if (error) throw new Error(`SUPABASE_COST_INSERT_FAILED:${error.message}`);
  }

  async listCostUsage(request: Request, context: UserContext): Promise<unknown[]> {
    const supabase = createRequestClient(request);
    if (!supabase) return this.fallback.listCostUsage(request, context);

    const { data, error } = await supabase
      .from("cost_usage_logs")
      .select("*")
      .eq("tenant_id", context.tenantId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`SUPABASE_COST_SELECT_FAILED:${error.message}`);
    return data ?? [];
  }

  async summarizeCostUsage(request: Request, context: UserContext, now = new Date()): Promise<CostUsageSummary> {
    const supabase = createRequestClient(request);
    if (!supabase) return this.fallback.summarizeCostUsage(request, context, now);

    const { data, error } = await supabase
      .from("cost_usage_logs")
      .select("created_at, estimated_cost_krw, actual_cost_krw, related_job_id, status")
      .eq("tenant_id", context.tenantId)
      .gte("created_at", monthStartUtc(now).toISOString());
    if (error) throw new Error(`SUPABASE_COST_SUMMARY_FAILED:${error.message}`);
    return summarizeCostUsageRows(data ?? [], now);
  }

  async saveJob(request: Request, job: Record<string, unknown>): Promise<Record<string, unknown>> {
    const supabase = createRequestClient(request);
    if (!supabase) return this.fallback.saveJob(request, job);

    const { error } = await supabase.from("creative_jobs").insert(toJobRow(job));
    if (error) throw new Error(`SUPABASE_JOB_INSERT_FAILED:${error.message}`);
    return job;
  }

  async getJob(request: Request, context: UserContext, id: string): Promise<Record<string, unknown> | null> {
    const supabase = createRequestClient(request);
    if (!supabase) return this.fallback.getJob(request, context, id);

    const { data, error } = await supabase
      .from("creative_jobs")
      .select("*")
      .eq("id", id)
      .eq("tenant_id", context.tenantId)
      .maybeSingle();
    if (error) throw new Error(`SUPABASE_JOB_SELECT_FAILED:${error.message}`);
    return data ? fromJobRow(data) : null;
  }

  async saveAsset(request: Request, asset: Record<string, unknown>): Promise<Record<string, unknown>> {
    const supabase = createRequestClient(request);
    if (!supabase) return this.fallback.saveAsset(request, asset);

    const { error } = await supabase.from("creative_assets").insert(toAssetRow(asset));
    if (error) throw new Error(`SUPABASE_ASSET_INSERT_FAILED:${error.message}`);
    return asset;
  }

  async saveMetaConnection(request: Request, connection: MetaConnectionInput): Promise<MetaConnectionInput> {
    const supabase = createRequestClient(request);
    if (!supabase) return this.fallback.saveMetaConnection(request, connection);

    const { error } = await supabase.from("meta_connections").insert(toMetaConnectionRow(connection));
    if (error) throw new Error(`SUPABASE_META_CONNECTION_INSERT_FAILED:${error.message}`);
    return connection;
  }

  async getLatestMetaConnection(
    request: Request,
    context: UserContext,
    provider: string
  ): Promise<MetaConnectionRecord | null> {
    const supabase = createRequestClient(request);
    if (!supabase) return this.fallback.getLatestMetaConnection(request, context, provider);

    const { data, error } = await supabase
      .from("meta_connections")
      .select("*")
      .eq("tenant_id", context.tenantId)
      .eq("provider", provider)
      .eq("status", "connected")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`SUPABASE_META_CONNECTION_SELECT_FAILED:${error.message}`);
    return data ? fromMetaConnectionRow(data as MetaConnectionRow) : null;
  }

  async getIntegrationSettings(
    request: Request,
    context: UserContext,
    provider: string
  ): Promise<IntegrationSettingsRecord | null> {
    const supabase = createRequestClient(request);
    if (!supabase) return this.fallback.getIntegrationSettings(request, context, provider);

    const { data, error } = await supabase
      .from("integration_settings")
      .select("*")
      .eq("tenant_id", context.tenantId)
      .eq("provider", provider)
      .maybeSingle();
    if (error) throw new Error(`SUPABASE_SETTINGS_SELECT_FAILED:${error.message}`);
    return data ? fromIntegrationSettingsRow(data as IntegrationSettingsRow) : null;
  }

  async saveIntegrationSettings(request: Request, settings: IntegrationSettingsRecord): Promise<IntegrationSettingsRecord> {
    const supabase = createRequestClient(request);
    if (!supabase) return this.fallback.saveIntegrationSettings(request, settings);

    if (!settings.id) {
      const { data, error } = await supabase
        .from("integration_settings")
        .insert(toIntegrationSettingsInsertRow(settings))
        .select("*")
        .single();
      if (error) throw new Error(`SUPABASE_SETTINGS_INSERT_FAILED:${error.message}`);
      return fromIntegrationSettingsRow(data as IntegrationSettingsRow);
    }

    const { data, error } = await supabase
      .from("integration_settings")
      .update(toIntegrationSettingsUpdateRow(settings))
      .eq("id", settings.id)
      .eq("tenant_id", settings.tenantId)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(`SUPABASE_SETTINGS_UPDATE_FAILED:${error.message}`);
    if (!data) throw new Error("SUPABASE_SETTINGS_UPDATE_MISSED");
    return fromIntegrationSettingsRow(data as IntegrationSettingsRow);
  }

  async saveAdDraft(request: Request, draft: AdDraftRecord): Promise<AdDraftRecord> {
    const supabase = createRequestClient(request);
    if (!supabase) return this.fallback.saveAdDraft(request, draft);

    const { data, error } = await supabase.from("ad_drafts").insert(toAdDraftInsertRow(draft)).select("*").single();
    if (error) throw new Error(`SUPABASE_AD_DRAFT_INSERT_FAILED:${error.message}`);
    return fromAdDraftRow(data as AdDraftRow);
  }

  async getAdDraft(request: Request, context: UserContext, id: string): Promise<AdDraftRecord | null> {
    const supabase = createRequestClient(request);
    if (!supabase) return this.fallback.getAdDraft(request, context, id);

    const { data, error } = await supabase
      .from("ad_drafts")
      .select("*")
      .eq("id", id)
      .eq("tenant_id", context.tenantId)
      .maybeSingle();
    if (error) throw new Error(`SUPABASE_AD_DRAFT_SELECT_FAILED:${error.message}`);
    return data ? fromAdDraftRow(data as AdDraftRow) : null;
  }

  async savePerformanceFusionReport(
    request: Request,
    report: PerformanceFusionReportRecord
  ): Promise<PerformanceFusionReportRecord> {
    const supabase = createRequestClient(request);
    if (!supabase) return this.fallback.savePerformanceFusionReport(request, report);

    const { data, error } = await supabase
      .from("performance_fusion_reports")
      .insert(toPerformanceFusionReportInsertRow(report))
      .select("*")
      .single();
    if (error) throw new Error(`SUPABASE_PERFORMANCE_FUSION_INSERT_FAILED:${error.message}`);
    return fromPerformanceFusionReportRow(data as PerformanceFusionReportRow);
  }

  async getPerformanceFusionReport(
    request: Request,
    context: UserContext,
    id: string
  ): Promise<PerformanceFusionReportRecord | null> {
    const supabase = createRequestClient(request);
    if (!supabase) return this.fallback.getPerformanceFusionReport(request, context, id);

    const { data, error } = await supabase
      .from("performance_fusion_reports")
      .select("*")
      .eq("id", id)
      .eq("tenant_id", context.tenantId)
      .maybeSingle();
    if (error) throw new Error(`SUPABASE_PERFORMANCE_FUSION_SELECT_FAILED:${error.message}`);
    return data ? fromPerformanceFusionReportRow(data as PerformanceFusionReportRow) : null;
  }

  async savePlacementValidationReport(
    request: Request,
    report: PlacementValidationReportRecord
  ): Promise<PlacementValidationReportRecord> {
    const supabase = createRequestClient(request);
    if (!supabase) return this.fallback.savePlacementValidationReport(request, report);

    const { data, error } = await supabase
      .from("placement_validation_reports")
      .insert(toPlacementValidationReportInsertRow(report))
      .select("*")
      .single();
    if (error) throw new Error(`SUPABASE_PLACEMENT_VALIDATION_INSERT_FAILED:${error.message}`);
    return fromPlacementValidationReportRow(data as PlacementValidationReportRow);
  }

  async getPlacementValidationReport(
    request: Request,
    context: UserContext,
    id: string
  ): Promise<PlacementValidationReportRecord | null> {
    const supabase = createRequestClient(request);
    if (!supabase) return this.fallback.getPlacementValidationReport(request, context, id);

    const { data, error } = await supabase
      .from("placement_validation_reports")
      .select("*")
      .eq("id", id)
      .eq("tenant_id", context.tenantId)
      .maybeSingle();
    if (error) throw new Error(`SUPABASE_PLACEMENT_VALIDATION_SELECT_FAILED:${error.message}`);
    return data ? fromPlacementValidationReportRow(data as PlacementValidationReportRow) : null;
  }
}

function createRequestClient(request: Request) {
  return createSupabaseClient("user", getBearerAuthorization(request));
}

export function requestAuditMetadata(request: Request): Pick<AuditLogInput, "ipAddress" | "userAgent"> {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const firstForwardedIp = forwardedFor?.split(",")[0]?.trim();
  const ipAddress = firstForwardedIp || request.headers.get("x-real-ip")?.trim() || undefined;
  const userAgent = request.headers.get("user-agent")?.trim() || undefined;

  return {
    ipAddress,
    userAgent
  };
}

function withRequestAuditMetadata(request: Request, audit: AuditLogInput): AuditLogInput {
  const metadata = requestAuditMetadata(request);

  return {
    ...audit,
    beforeJson: audit.beforeJson === undefined ? undefined : redactCredentialPayload(audit.beforeJson),
    afterJson: audit.afterJson === undefined ? undefined : redactCredentialPayload(audit.afterJson),
    ipAddress: audit.ipAddress ?? metadata.ipAddress,
    userAgent: audit.userAgent ?? metadata.userAgent
  };
}

interface ApprovalRow {
  id: string;
  tenant_id: string;
  created_at: string;
  created_by: string;
  requested_by: string;
  approved_by?: string | null;
  second_approved_by?: string | null;
  action: ApprovalRequest["action"];
  risk_level: ApprovalRequest["riskLevel"];
  object_type: string;
  object_id?: string | null;
  status: ApprovalRequest["status"];
  requires_second_approval: boolean;
  before_json?: unknown;
  after_json?: unknown;
  diff_json?: unknown;
  reason?: string | null;
  execution_result_json?: unknown;
  expires_at?: string | null;
}

interface IntegrationSettingsRow {
  id: string;
  tenant_id: string;
  created_by?: string | null;
  provider: string;
  settings_json: unknown;
  created_at: string;
  updated_at: string;
}

interface MetaConnectionRow {
  id: string;
  tenant_id: string;
  created_by: string;
  provider: string;
  connection_mode: string;
  encrypted_access_token: string;
  token_iv: string;
  token_auth_tag: string;
  token_kid: string;
  scopes: string[];
  expires_at?: string | null;
  status: string;
  metadata_json?: unknown;
  created_at: string;
}

interface AdDraftRow {
  id: string;
  tenant_id: string;
  created_by?: string | null;
  ad_account_id?: string | null;
  asset_id?: string | null;
  approval_request_id?: string | null;
  meta_campaign_id?: string | null;
  meta_adset_id?: string | null;
  meta_ad_id?: string | null;
  draft_type: string;
  meta_status: AdDraftRecord["metaStatus"];
  preflight_json: unknown;
  payload_json: unknown;
  created_at: string;
  updated_at: string;
}

interface PerformanceFusionReportRow {
  id: string;
  tenant_id: string;
  created_by?: string | null;
  asset_id?: string | null;
  bottleneck_job_id?: string | null;
  report_json: unknown;
  language_guard: string;
  created_at: string;
  updated_at: string;
}

interface PlacementValidationReportRow {
  id: string;
  tenant_id: string;
  created_by?: string | null;
  asset_id?: string | null;
  placements: string[];
  status: string;
  error_1487569_risk: boolean;
  report_json: unknown;
  created_at: string;
  updated_at: string;
}

function toApprovalRow(approval: ApprovalRequest): Record<string, unknown> {
  return {
    id: approval.id,
    tenant_id: approval.tenantId,
    created_by: approval.createdBy,
    requested_by: approval.requestedBy,
    approved_by: approval.approvedBy,
    second_approved_by: approval.secondApprovedBy,
    action: approval.action,
    risk_level: approval.riskLevel,
    object_type: approval.objectType,
    object_id: approval.objectId,
    status: approval.status,
    requires_second_approval: approval.requiresSecondApproval,
    before_json: approval.beforeJson ?? {},
    after_json: approval.afterJson ?? {},
    diff_json: approval.diffJson ?? {},
    reason: approval.reason,
    execution_result_json: approval.executionResultJson ?? {},
    expires_at: approval.expiresAt
  };
}

function fromApprovalRow(row: ApprovalRow): ApprovalRequest {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    createdAt: row.created_at,
    createdBy: row.created_by,
    requestedBy: row.requested_by,
    approvedBy: row.approved_by ?? undefined,
    secondApprovedBy: row.second_approved_by ?? undefined,
    action: row.action,
    riskLevel: row.risk_level,
    objectType: row.object_type,
    objectId: row.object_id ?? undefined,
    status: row.status,
    requiresSecondApproval: row.requires_second_approval,
    beforeJson: row.before_json,
    afterJson: row.after_json,
    diffJson: row.diff_json,
    reason: row.reason ?? undefined,
    executionResultJson: row.execution_result_json,
    expiresAt: row.expires_at ?? undefined
  };
}

function toJobRow(job: Record<string, unknown>): Record<string, unknown> {
  return {
    id: job.id,
    tenant_id: job.tenantId,
    created_by: job.createdBy,
    job_type: job.type ?? "api_job",
    status: job.status ?? "queued",
    result_json: job.result ?? {},
    input_json: job.input ?? {}
  };
}

function fromJobRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    createdBy: row.created_by,
    type: row.job_type,
    status: row.status,
    result: row.result_json,
    input: row.input_json
  };
}

function toAssetRow(asset: Record<string, unknown>): Record<string, unknown> {
  const inputAsset = asset.asset as Record<string, unknown> | undefined;
  return {
    id: asset.id,
    tenant_id: asset.tenantId,
    created_by: asset.createdBy,
    asset_type: asset.assetType ?? inputAsset?.type ?? "image",
    width: asset.width ?? inputAsset?.width,
    height: asset.height ?? inputAsset?.height,
    duration_seconds: asset.durationSeconds ?? inputAsset?.durationSeconds,
    mime_type: asset.mimeType ?? inputAsset?.mimeType,
    metadata_json: asset
  };
}

function toMetaConnectionRow(connection: MetaConnectionInput): Record<string, unknown> {
  return {
    id: connection.id,
    tenant_id: connection.tenantId,
    created_by: connection.createdBy,
    provider: connection.provider,
    connection_mode: connection.connectionMode,
    encrypted_access_token: connection.encryptedAccessToken,
    token_iv: connection.tokenIv,
    token_auth_tag: connection.tokenAuthTag,
    token_kid: connection.tokenKid,
    scopes: connection.scopes,
    expires_at: connection.expiresAt,
    status: connection.status,
    metadata_json: connection.metadataJson ?? {}
  };
}

function fromMetaConnectionRow(row: MetaConnectionRow): MetaConnectionRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    createdBy: row.created_by,
    provider: row.provider,
    connectionMode: row.connection_mode,
    encryptedAccessToken: row.encrypted_access_token,
    tokenIv: row.token_iv,
    tokenAuthTag: row.token_auth_tag,
    tokenKid: row.token_kid,
    scopes: row.scopes,
    expiresAt: row.expires_at ?? undefined,
    status: row.status,
    metadataJson: row.metadata_json,
    createdAt: row.created_at
  };
}

function toIntegrationSettingsInsertRow(settings: IntegrationSettingsRecord): Record<string, unknown> {
  return {
    tenant_id: settings.tenantId,
    created_by: settings.createdBy,
    provider: settings.provider,
    settings_json: settings.settingsJson ?? {}
  };
}

function toIntegrationSettingsUpdateRow(settings: IntegrationSettingsRecord): Record<string, unknown> {
  return {
    provider: settings.provider,
    settings_json: settings.settingsJson ?? {}
  };
}

function fromIntegrationSettingsRow(row: IntegrationSettingsRow): IntegrationSettingsRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    createdBy: row.created_by ?? undefined,
    provider: row.provider,
    settingsJson: row.settings_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toAdDraftInsertRow(draft: AdDraftRecord): Record<string, unknown> {
  return {
    id: draft.id,
    tenant_id: draft.tenantId,
    created_by: draft.createdBy,
    ad_account_id: draft.adAccountId,
    asset_id: draft.assetId,
    approval_request_id: draft.approvalRequestId,
    meta_campaign_id: draft.metaCampaignId,
    meta_adset_id: draft.metaAdsetId,
    meta_ad_id: draft.metaAdId,
    draft_type: draft.draftType,
    meta_status: draft.metaStatus,
    preflight_json: draft.preflightJson ?? {},
    payload_json: draft.payloadJson ?? {}
  };
}

function fromAdDraftRow(row: AdDraftRow): AdDraftRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    createdBy: row.created_by ?? undefined,
    adAccountId: row.ad_account_id ?? undefined,
    assetId: row.asset_id ?? undefined,
    approvalRequestId: row.approval_request_id ?? undefined,
    metaCampaignId: row.meta_campaign_id ?? undefined,
    metaAdsetId: row.meta_adset_id ?? undefined,
    metaAdId: row.meta_ad_id ?? undefined,
    draftType: row.draft_type,
    metaStatus: row.meta_status,
    preflightJson: row.preflight_json,
    payloadJson: row.payload_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toPerformanceFusionReportInsertRow(report: PerformanceFusionReportRecord): Record<string, unknown> {
  return {
    id: report.id,
    tenant_id: report.tenantId,
    created_by: report.createdBy,
    asset_id: report.assetId,
    bottleneck_job_id: report.bottleneckJobId,
    report_json: report.reportJson ?? {},
    language_guard: report.languageGuard
  };
}

function fromPerformanceFusionReportRow(row: PerformanceFusionReportRow): PerformanceFusionReportRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    createdBy: row.created_by ?? undefined,
    assetId: row.asset_id ?? undefined,
    bottleneckJobId: row.bottleneck_job_id ?? undefined,
    reportJson: row.report_json,
    languageGuard: row.language_guard,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toPlacementValidationReportInsertRow(report: PlacementValidationReportRecord): Record<string, unknown> {
  return {
    id: report.id,
    tenant_id: report.tenantId,
    created_by: report.createdBy,
    asset_id: report.assetId,
    placements: report.placements,
    status: report.status,
    error_1487569_risk: report.error1487569Risk,
    report_json: report.reportJson ?? {}
  };
}

function fromPlacementValidationReportRow(row: PlacementValidationReportRow): PlacementValidationReportRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    createdBy: row.created_by ?? undefined,
    assetId: row.asset_id ?? undefined,
    placements: row.placements,
    status: row.status,
    error1487569Risk: row.error_1487569_risk,
    reportJson: row.report_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function costUsageFromEstimate(
  input: CostEstimateInput,
  context: UserContext,
  estimatedCostKrw: number,
  relatedJobId?: string
): CostUsageInput {
  return {
    tenantId: context.tenantId,
    userId: context.userId,
    provider: input.settings.providerName,
    model: input.model,
    operationType: input.operationType,
    estimatedCredits: estimateOperationCredits(input),
    estimatedCostKrw,
    relatedJobId,
    status: "estimated"
  };
}

export function costUsageFromExecutedApproval(approval: ApprovalRequest, context: UserContext): CostUsageInput {
  const estimatedCredits = readNumberField(approval.afterJson, "estimatedCredits") ?? 0;
  const estimatedCostKrw = readNumberField(approval.afterJson, "estimatedCostKrw") ?? 0;

  return {
    tenantId: context.tenantId,
    userId: context.userId,
    provider: readStringField(approval.afterJson, "providerName") ?? "unknown",
    model: readStringField(approval.afterJson, "model"),
    operationType: readStringField(approval.afterJson, "operationType") ?? approval.objectType,
    estimatedCredits,
    actualCredits: readNumberField(approval.afterJson, "actualCredits") ?? estimatedCredits,
    estimatedCostKrw,
    actualCostKrw: readNumberField(approval.afterJson, "actualCostKrw") ?? estimatedCostKrw,
    relatedJobId: approval.id,
    status: "succeeded"
  };
}

export function summarizeCostUsageRows(rows: unknown[], now = new Date()): CostUsageSummary {
  const todayStart = dayStartUtc(now).getTime();
  const monthStart = monthStartUtc(now).getTime();
  const groupedRows = groupCostUsageRows(rows);

  return Array.from(groupedRows.values()).reduce<CostUsageSummary>(
    (summary, group) => {
      const row = chooseCostUsageRow(group, now);
      if (!shouldCountCostUsage(row)) {
        return summary;
      }
      const createdAtMs = readCostUsageCreatedAt(row, now);
      const costKrw = readCostUsageCostKrw(row);
      if (createdAtMs >= monthStart) {
        summary.monthActualCostKrw += costKrw;
      }
      if (createdAtMs >= todayStart) {
        summary.todayActualCostKrw += costKrw;
      }
      return summary;
    },
    {
      todayActualCostKrw: 0,
      monthActualCostKrw: 0
    }
  );
}

function groupCostUsageRows(rows: unknown[]): Map<string, unknown[]> {
  return rows.reduce<Map<string, unknown[]>>((groups, row, index) => {
    const relatedJobId = readStringField(row, "relatedJobId") ?? readStringField(row, "related_job_id");
    const key = relatedJobId ? `job:${relatedJobId}` : `row:${index}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
    return groups;
  }, new Map());
}

function chooseCostUsageRow(rows: unknown[], now: Date): unknown {
  return rows.reduce((chosen, row) => {
    const rowPriority = costUsagePriority(row);
    const chosenPriority = costUsagePriority(chosen);
    if (rowPriority > chosenPriority) {
      return row;
    }
    if (rowPriority === chosenPriority && readCostUsageCreatedAt(row, now) > readCostUsageCreatedAt(chosen, now)) {
      return row;
    }
    return chosen;
  });
}

function costUsagePriority(row: unknown): number {
  const status = readStringField(row, "status")?.toLowerCase();
  if (status === "succeeded" || status === "executed" || status === "failed" || status === "cancelled") {
    return 3;
  }
  if (status === "running") {
    return 2;
  }
  return 1;
}

function shouldCountCostUsage(row: unknown): boolean {
  const status = readStringField(row, "status")?.toLowerCase();
  return status !== "failed" && status !== "cancelled";
}

function readCostUsageCreatedAt(row: unknown, fallbackNow: Date): number {
  const rawCreatedAt = readStringField(row, "createdAt") ?? readStringField(row, "created_at");
  const parsed = rawCreatedAt ? Date.parse(rawCreatedAt) : Number.NaN;
  return Number.isNaN(parsed) ? fallbackNow.getTime() : parsed;
}

function readCostUsageCostKrw(row: unknown): number {
  return (
    readNumberField(row, "actualCostKrw") ??
    readNumberField(row, "actual_cost_krw") ??
    readNumberField(row, "estimatedCostKrw") ??
    readNumberField(row, "estimated_cost_krw") ??
    0
  );
}

function readStringField(row: unknown, key: string): string | undefined {
  if (typeof row !== "object" || row === null || !(key in row)) {
    return undefined;
  }
  const value = (row as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function readNumberField(row: unknown, key: string): number | undefined {
  if (typeof row !== "object" || row === null || !(key in row)) {
    return undefined;
  }
  const value = (row as Record<string, unknown>)[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function dayStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function monthStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function settingKey(tenantId: string, provider: string): string {
  return `${tenantId}:${provider}`;
}
