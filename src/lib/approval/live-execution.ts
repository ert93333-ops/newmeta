import type { ApprovalExecutionResult } from "@/lib/approval/execution-policy";
import { assertNoBudgetMutation } from "@/lib/guards/budget-guard";
import { resolveMetaAdapter } from "@/lib/meta/resolve-meta-adapter";
import type { UpdateStatusRequest } from "@/lib/meta/meta-adapter";
import type { HermesRepository } from "@/lib/repositories/hermes-repository";
import type { ApprovalAction, ApprovalRequest, UserContext } from "@/lib/types";

type LiveMetaStatusAction =
  | "meta_activate_campaign"
  | "meta_activate_adset"
  | "meta_activate_ad"
  | "meta_pause_ad"
  | "meta_delete_ad";

interface LiveMetaExecutionSpec {
  objectType: UpdateStatusRequest["objectType"];
  status: UpdateStatusRequest["status"];
  result: string;
}

const LIVE_META_EXECUTION_SPECS: Record<LiveMetaStatusAction, LiveMetaExecutionSpec> = {
  meta_activate_campaign: {
    objectType: "campaign",
    status: "ACTIVE",
    result: "meta_campaign_activated"
  },
  meta_activate_adset: {
    objectType: "adset",
    status: "ACTIVE",
    result: "meta_adset_activated"
  },
  meta_activate_ad: {
    objectType: "ad",
    status: "ACTIVE",
    result: "meta_ad_activated"
  },
  meta_pause_ad: {
    objectType: "ad",
    status: "PAUSED",
    result: "meta_ad_paused"
  },
  meta_delete_ad: {
    objectType: "ad",
    status: "DELETED",
    result: "meta_ad_deleted"
  }
};

export function supportsLiveApprovalExecution(action: ApprovalAction): boolean {
  return action in LIVE_META_EXECUTION_SPECS;
}

export function liveApprovalExecutionPlan(action: ApprovalAction): { mode: "live"; result: string } | null {
  if (!supportsLiveApprovalExecution(action)) {
    return null;
  }

  const spec = LIVE_META_EXECUTION_SPECS[action as LiveMetaStatusAction];
  return {
    mode: "live",
    result: spec.result
  };
}

export async function executeLiveApprovedAction(
  request: Request,
  context: UserContext,
  approval: ApprovalRequest,
  repository: HermesRepository
): Promise<ApprovalExecutionResult> {
  assertNoBudgetMutation(approval);

  const spec = LIVE_META_EXECUTION_SPECS[approval.action as LiveMetaStatusAction];
  if (!spec) {
    throw new Error("LIVE_APPROVAL_EXECUTOR_NOT_CONFIGURED");
  }

  const objectId = approval.objectId?.trim();
  if (!objectId) {
    throw new Error("APPROVAL_OBJECT_ID_REQUIRED");
  }

  const resolved = await resolveMetaAdapter({
    request,
    context,
    repository
  });
  if (resolved.mode !== "live") {
    throw new Error("META_CONNECTION_REQUIRED");
  }

  const updated = await resolved.adapter.updateStatusWithApproval({
    objectId,
    objectType: spec.objectType,
    status: spec.status,
    approval
  });

  return {
    mode: "live",
    result: spec.result,
    operation: approval.action,
    externalObjectId: updated.id,
    externalStatus: updated.status,
    details: {
      approvalId: approval.id,
      tenantId: approval.tenantId,
      objectType: spec.objectType,
      targetStatus: spec.status,
      connectionSource: resolved.source,
      ...(resolved.connectionId ? { connectionId: resolved.connectionId } : {}),
      mockSafe: false
    }
  };
}
