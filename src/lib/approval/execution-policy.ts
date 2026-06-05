import { isProductionRuntime } from "@/lib/api/context";
import { assertApprovalNotExpired } from "@/lib/approval/approval-policy";
import { assertNoBudgetMutation } from "@/lib/guards/budget-guard";
import type { ApprovalAction, ApprovalRequest } from "@/lib/types";

export type ApprovalExecutionMode = "mock" | "live";
type GenericApprovalAction = Exclude<ApprovalAction, "ai_paid_generation" | "meta_create_ad_paused">;

export interface ApprovalExecutionPlan {
  mode: ApprovalExecutionMode;
  result: string;
}

export interface ApprovalExecutionResult extends ApprovalExecutionPlan {
  operation: ApprovalAction;
  externalObjectId: string;
  externalStatus?: "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED" | "PAUSED_READY" | "GENERATED";
  details: Record<string, string | boolean>;
}

interface MockExecutionTemplate {
  result: string;
  externalStatus?: ApprovalExecutionResult["externalStatus"];
  objectPrefix: string;
}

export class PaidOperationDomainExecutorRequiredError extends Error {
  readonly code = "PAID_OPERATION_EXECUTOR_REQUIRED";

  constructor(readonly action: ApprovalAction) {
    super("PAID_OPERATION_EXECUTOR_REQUIRED");
  }
}

export class ApprovalActionDomainExecutorRequiredError extends Error {
  readonly code = "APPROVAL_ACTION_EXECUTOR_REQUIRED";

  constructor(
    readonly action: ApprovalAction,
    readonly route: string
  ) {
    super("APPROVAL_ACTION_EXECUTOR_REQUIRED");
  }
}

const MOCK_EXECUTION_TEMPLATES: Record<GenericApprovalAction, MockExecutionTemplate> = {
  meta_upload_image: {
    result: "mock_uploaded_image",
    externalStatus: "PAUSED_READY",
    objectPrefix: "image"
  },
  meta_upload_video: {
    result: "mock_uploaded_video",
    externalStatus: "PAUSED_READY",
    objectPrefix: "video"
  },
  meta_create_creative: {
    result: "mock_created_creative",
    externalStatus: "PAUSED_READY",
    objectPrefix: "creative"
  },
  meta_create_campaign_paused: {
    result: "mock_created_campaign_paused",
    externalStatus: "PAUSED",
    objectPrefix: "campaign"
  },
  meta_create_adset_paused: {
    result: "mock_created_adset_paused",
    externalStatus: "PAUSED",
    objectPrefix: "adset"
  },
  meta_activate_campaign: {
    result: "mock_activated_campaign",
    externalStatus: "ACTIVE",
    objectPrefix: "campaign"
  },
  meta_activate_adset: {
    result: "mock_activated_adset",
    externalStatus: "ACTIVE",
    objectPrefix: "adset"
  },
  meta_activate_ad: {
    result: "mock_activated_ad",
    externalStatus: "ACTIVE",
    objectPrefix: "ad"
  },
  meta_pause_ad: {
    result: "mock_paused_ad",
    externalStatus: "PAUSED",
    objectPrefix: "ad"
  },
  meta_delete_ad: {
    result: "mock_deleted_ad",
    externalStatus: "DELETED",
    objectPrefix: "ad"
  },
  meta_disconnect_connection: {
    result: "mock_disconnected_meta_connection",
    externalStatus: "DELETED",
    objectPrefix: "meta_connection"
  },
  meta_change_targeting: {
    result: "mock_changed_targeting",
    objectPrefix: "targeting"
  },
  meta_replace_creative: {
    result: "mock_replaced_creative",
    objectPrefix: "creative"
  },
  catalog_mutation: {
    result: "mock_catalog_mutation",
    objectPrefix: "catalog"
  },
  tenant_data_deletion: {
    result: "mock_tenant_data_deletion_recorded",
    objectPrefix: "data_deletion_request"
  }
};

export function configuredApprovalExecutionMode(): ApprovalExecutionMode {
  return process.env.HERMES_APPROVAL_EXECUTION_MODE === "live" ? "live" : "mock";
}

export function planApprovalExecution(action: ApprovalAction): ApprovalExecutionPlan {
  const executableAction = genericApprovalAction(action);
  const mode = configuredApprovalExecutionMode();

  if (mode === "mock") {
    if (isProductionRuntime()) {
      throw new Error("MOCK_EXECUTION_DISABLED_IN_PRODUCTION");
    }
    return {
      mode,
      result: MOCK_EXECUTION_TEMPLATES[executableAction].result
    };
  }

  throw new Error("LIVE_APPROVAL_EXECUTOR_NOT_CONFIGURED");
}

export function executeApprovedAction(approval: ApprovalRequest): ApprovalExecutionResult {
  assertApprovalNotExpired(approval);
  assertNoBudgetMutation(approval);
  const action = genericApprovalAction(approval.action);
  const plan = planApprovalExecution(action);
  const template = MOCK_EXECUTION_TEMPLATES[action];
  const externalObjectId = approval.objectId ?? `${template.objectPrefix}_${approval.id}`;

  return {
    ...plan,
    operation: action,
    externalObjectId,
    externalStatus: template.externalStatus,
    details: {
      approvalId: approval.id,
      tenantId: approval.tenantId,
      mockSafe: plan.mode === "mock"
    }
  };
}

export function isPaidOperationDomainExecutorRequiredError(
  error: unknown
): error is PaidOperationDomainExecutorRequiredError {
  return error instanceof PaidOperationDomainExecutorRequiredError;
}

export function isApprovalActionDomainExecutorRequiredError(
  error: unknown
): error is ApprovalActionDomainExecutorRequiredError {
  return error instanceof ApprovalActionDomainExecutorRequiredError;
}

function genericApprovalAction(action: ApprovalAction): GenericApprovalAction {
  if (action === "ai_paid_generation") {
    throw new PaidOperationDomainExecutorRequiredError(action);
  }
  if (action === "meta_create_ad_paused") {
    throw new ApprovalActionDomainExecutorRequiredError(action, "/api/drafts/create-paused");
  }
  return action;
}
