import type { ApprovalRequest, CostEstimateInput, UserContext } from "@/lib/types";
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
}

export interface HermesRepository {
  saveApproval(request: Request, approval: ApprovalRequest): Promise<ApprovalRequest>;
  getApproval(request: Request, context: UserContext, id: string): Promise<ApprovalRequest | null>;
  updateApproval(request: Request, approval: ApprovalRequest): Promise<ApprovalRequest>;
  saveAuditLog(request: Request, audit: AuditLogInput): Promise<void>;
  saveCostUsage(request: Request, usage: CostUsageInput): Promise<void>;
  listCostUsage(request: Request, context: UserContext): Promise<unknown[]>;
  saveJob(request: Request, job: Record<string, unknown>): Promise<Record<string, unknown>>;
  getJob(request: Request, context: UserContext, id: string): Promise<Record<string, unknown> | null>;
  saveAsset(request: Request, asset: Record<string, unknown>): Promise<Record<string, unknown>>;
}

interface HermesMemoryStore {
  approvals: Map<string, ApprovalRequest>;
  jobs: Map<string, Record<string, unknown>>;
  assets: Map<string, Record<string, unknown>>;
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

  async updateApproval(_request: Request, approval: ApprovalRequest): Promise<ApprovalRequest> {
    getMemoryStore().approvals.set(approval.id, approval);
    return approval;
  }

  async saveAuditLog(_request: Request, audit: AuditLogInput): Promise<void> {
    getMemoryStore().auditLogs.push(audit);
  }

  async saveCostUsage(_request: Request, usage: CostUsageInput): Promise<void> {
    getMemoryStore().costUsage.push(usage);
  }

  async listCostUsage(_request: Request, context: UserContext): Promise<unknown[]> {
    return getMemoryStore().costUsage.filter((item) => {
      return typeof item === "object" && item !== null && "tenantId" in item && item.tenantId === context.tenantId;
    });
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

  async updateApproval(request: Request, approval: ApprovalRequest): Promise<ApprovalRequest> {
    const supabase = createRequestClient(request);
    if (!supabase) return this.fallback.updateApproval(request, approval);

    const { error } = await supabase
      .from("approval_requests")
      .update(toApprovalRow(approval))
      .eq("id", approval.id)
      .eq("tenant_id", approval.tenantId);
    if (error) throw new Error(`SUPABASE_APPROVAL_UPDATE_FAILED:${error.message}`);
    return approval;
  }

  async saveAuditLog(request: Request, audit: AuditLogInput): Promise<void> {
    const supabase = createRequestClient(request);
    if (!supabase) return this.fallback.saveAuditLog(request, audit);

    const { error } = await supabase.from("audit_logs").insert({
      tenant_id: audit.tenantId,
      created_by: audit.userId,
      user_id: audit.userId,
      action: audit.action,
      object_type: audit.objectType,
      object_id: audit.objectId,
      approval_request_id: audit.approvalRequestId,
      before_json: audit.beforeJson ?? {},
      after_json: audit.afterJson ?? {},
      result: audit.result ?? "recorded"
    });
    if (error) throw new Error(`SUPABASE_AUDIT_INSERT_FAILED:${error.message}`);
  }

  async saveCostUsage(request: Request, usage: CostUsageInput): Promise<void> {
    const supabase = createRequestClient(request);
    if (!supabase) return this.fallback.saveCostUsage(request, usage);

    const { error } = await supabase.from("cost_usage_logs").insert({
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
    });
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
}

function createRequestClient(request: Request) {
  return createSupabaseClient("user", getBearerAuthorization(request));
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
    reason: approval.reason
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
    reason: row.reason ?? undefined
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

export function costUsageFromEstimate(input: CostEstimateInput, context: UserContext, estimatedCostKrw: number): CostUsageInput {
  return {
    tenantId: context.tenantId,
    userId: context.userId,
    provider: input.settings.providerName,
    model: input.model,
    operationType: input.operationType,
    estimatedCredits: input.estimatedCredits ?? 0,
    estimatedCostKrw,
    status: "estimated"
  };
}
