import { isProductionRuntime } from "@/lib/api/context";
import { assertNoBudgetMutation } from "@/lib/guards/budget-guard";
import type { ApprovalAction, ApprovalRequest } from "@/lib/types";

export type ApprovalExecutionMode = "mock" | "live";

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

const MOCK_EXECUTION_TEMPLATES: Record<ApprovalAction, MockExecutionTemplate> = {
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
  meta_create_ad_paused: {
    result: "mock_created_ad_paused",
    externalStatus: "PAUSED",
    objectPrefix: "ad"
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
  ai_paid_generation: {
    result: "mock_paid_generation",
    externalStatus: "GENERATED",
    objectPrefix: "generation"
  }
};

export function configuredApprovalExecutionMode(): ApprovalExecutionMode {
  return process.env.HERMES_APPROVAL_EXECUTION_MODE === "live" ? "live" : "mock";
}

export function planApprovalExecution(action: ApprovalAction): ApprovalExecutionPlan {
  const mode = configuredApprovalExecutionMode();

  if (mode === "mock") {
    if (isProductionRuntime()) {
      throw new Error("MOCK_EXECUTION_DISABLED_IN_PRODUCTION");
    }
    return {
      mode,
      result: MOCK_EXECUTION_TEMPLATES[action].result
    };
  }

  throw new Error("LIVE_APPROVAL_EXECUTOR_NOT_CONFIGURED");
}

export function executeApprovedAction(approval: ApprovalRequest): ApprovalExecutionResult {
  assertNoBudgetMutation(approval);
  const plan = planApprovalExecution(approval.action);
  const template = MOCK_EXECUTION_TEMPLATES[approval.action];
  const externalObjectId = approval.objectId ?? `${template.objectPrefix}_${approval.id}`;

  return {
    ...plan,
    operation: approval.action,
    externalObjectId,
    externalStatus: template.externalStatus,
    details: {
      approvalId: approval.id,
      tenantId: approval.tenantId,
      mockSafe: plan.mode === "mock"
    }
  };
}
