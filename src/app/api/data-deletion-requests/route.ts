import { randomUUID } from "node:crypto";
import { approvalGuardDetails, createApprovalRequest } from "@/lib/approval/approval-policy";
import { handleError, ok, parseWriteJson } from "@/lib/api/responses";
import { resolveUserContext } from "@/lib/api/context";
import { getRepository } from "@/lib/repositories/hermes-repository";

const DEFAULT_DELETION_SCOPE = "tenant";
const ALLOWED_DELETION_SCOPES = new Set(["tenant", "meta_integration", "creative_assets", "learning_patterns"]);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export async function GET(request: Request) {
  try {
    const context = await resolveUserContext(request);
    const limit = readLimit(request);
    const deletionRequests = await getRepository().listDataDeletionRequests(request, context, limit);
    return ok({ deletionRequests });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveUserContext(request);
    const body = (await parseWriteJson(request)) as { scope?: unknown; reason?: unknown };
    const scope = readDeletionScope(body.scope);
    const reason = readReason(body.reason) ?? `Tenant data deletion requested for scope: ${scope}.`;
    const repository = getRepository();
    const deletionRequestId = randomUUID();
    const approval = createApprovalRequest({
      context,
      action: "tenant_data_deletion",
      objectType: "data_deletion_request",
      objectId: deletionRequestId,
      beforeJson: {
        tenantId: context.tenantId,
        status: "retained"
      },
      afterJson: {
        id: deletionRequestId,
        tenantId: context.tenantId,
        scope,
        status: "approval_required"
      },
      reason
    });
    const deletionRequest = await repository.saveDataDeletionRequest(request, {
      id: deletionRequestId,
      tenantId: context.tenantId,
      createdBy: context.userId,
      requestedBy: context.userId,
      scope,
      status: "approval_required",
      resultJson: {
        approvalStatus: approval.status,
        approvalRequestId: approval.id
      }
    });
    await repository.saveApproval(request, approval);
    await repository.saveAuditLog(request, {
      tenantId: context.tenantId,
      userId: context.userId,
      action: "approval_requested:tenant_data_deletion",
      objectType: "data_deletion_request",
      objectId: deletionRequest.id,
      approvalRequestId: approval.id,
      afterJson: {
        ...deletionRequest,
        deletes: ["tokens", "assets", "reports", "learning patterns", "integration data"]
      },
      result: "approval_required"
    });
    return ok({ deletionRequest, approval, guard: approvalGuardDetails(approval) }, 202);
  } catch (error) {
    return handleError(error);
  }
}

function readDeletionScope(value: unknown): string {
  if (typeof value !== "string") {
    return DEFAULT_DELETION_SCOPE;
  }

  const normalized = value.trim();
  return ALLOWED_DELETION_SCOPES.has(normalized) ? normalized : DEFAULT_DELETION_SCOPE;
}

function readReason(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized || undefined;
}

function readLimit(request: Request): number {
  const raw = new URL(request.url).searchParams.get("limit");
  if (!raw) {
    return DEFAULT_LIMIT;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }

  return Math.min(parsed, MAX_LIMIT);
}
