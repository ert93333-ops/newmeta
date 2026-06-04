import { randomUUID } from "node:crypto";
import type { ApprovalAction, ApprovalRequest, RiskLevel, UserContext } from "@/lib/types";
import { assertNoBudgetMutation } from "@/lib/guards/budget-guard";
import { assertRole } from "@/lib/security/rbac";

export interface ApprovalPolicy {
  action: ApprovalAction;
  riskLevel: RiskLevel;
  minimumRequesterRole: "owner" | "admin" | "marketer" | "analyst" | "viewer";
  executorRole: "owner" | "admin" | "marketer" | "analyst" | "viewer";
  requiresSecondApproval: boolean;
}

export interface ApprovalConfirmationOptions {
  typedConfirmation?: string;
}

export class TypedConfirmationRequiredError extends Error {
  readonly code = "TYPED_CONFIRMATION_REQUIRED";

  constructor(readonly requiredText: string) {
    super("TYPED_CONFIRMATION_REQUIRED");
  }
}

const POLICIES: Record<ApprovalAction, ApprovalPolicy> = {
  meta_upload_image: {
    action: "meta_upload_image",
    riskLevel: "draft",
    minimumRequesterRole: "marketer",
    executorRole: "marketer",
    requiresSecondApproval: false
  },
  meta_upload_video: {
    action: "meta_upload_video",
    riskLevel: "draft",
    minimumRequesterRole: "marketer",
    executorRole: "marketer",
    requiresSecondApproval: false
  },
  meta_create_creative: {
    action: "meta_create_creative",
    riskLevel: "draft",
    minimumRequesterRole: "marketer",
    executorRole: "marketer",
    requiresSecondApproval: false
  },
  meta_create_campaign_paused: {
    action: "meta_create_campaign_paused",
    riskLevel: "draft",
    minimumRequesterRole: "marketer",
    executorRole: "marketer",
    requiresSecondApproval: false
  },
  meta_create_adset_paused: {
    action: "meta_create_adset_paused",
    riskLevel: "draft",
    minimumRequesterRole: "marketer",
    executorRole: "marketer",
    requiresSecondApproval: false
  },
  meta_create_ad_paused: {
    action: "meta_create_ad_paused",
    riskLevel: "draft",
    minimumRequesterRole: "marketer",
    executorRole: "marketer",
    requiresSecondApproval: false
  },
  meta_activate_campaign: {
    action: "meta_activate_campaign",
    riskLevel: "publish",
    minimumRequesterRole: "marketer",
    executorRole: "admin",
    requiresSecondApproval: false
  },
  meta_activate_adset: {
    action: "meta_activate_adset",
    riskLevel: "publish",
    minimumRequesterRole: "marketer",
    executorRole: "admin",
    requiresSecondApproval: false
  },
  meta_activate_ad: {
    action: "meta_activate_ad",
    riskLevel: "publish",
    minimumRequesterRole: "marketer",
    executorRole: "admin",
    requiresSecondApproval: false
  },
  meta_pause_ad: {
    action: "meta_pause_ad",
    riskLevel: "destructive",
    minimumRequesterRole: "admin",
    executorRole: "admin",
    requiresSecondApproval: true
  },
  meta_delete_ad: {
    action: "meta_delete_ad",
    riskLevel: "destructive",
    minimumRequesterRole: "admin",
    executorRole: "admin",
    requiresSecondApproval: true
  },
  meta_change_targeting: {
    action: "meta_change_targeting",
    riskLevel: "destructive",
    minimumRequesterRole: "admin",
    executorRole: "admin",
    requiresSecondApproval: true
  },
  meta_replace_creative: {
    action: "meta_replace_creative",
    riskLevel: "destructive",
    minimumRequesterRole: "admin",
    executorRole: "admin",
    requiresSecondApproval: true
  },
  catalog_mutation: {
    action: "catalog_mutation",
    riskLevel: "destructive",
    minimumRequesterRole: "admin",
    executorRole: "admin",
    requiresSecondApproval: true
  },
  ai_paid_generation: {
    action: "ai_paid_generation",
    riskLevel: "draft",
    minimumRequesterRole: "marketer",
    executorRole: "marketer",
    requiresSecondApproval: false
  }
};

export function getApprovalPolicy(action: ApprovalAction): ApprovalPolicy {
  return POLICIES[action];
}

export function isTypedConfirmationRequiredError(error: unknown): error is TypedConfirmationRequiredError {
  return error instanceof TypedConfirmationRequiredError;
}

export function requiredTypedConfirmation(request: ApprovalRequest): string | undefined {
  if (request.riskLevel !== "publish" && request.riskLevel !== "destructive") {
    return undefined;
  }

  return `APPROVE ${request.action}`;
}

export function approvalGuardDetails(request: ApprovalRequest): {
  riskLevel: RiskLevel;
  requiresSecondApproval: boolean;
  typedConfirmationRequired: boolean;
  requiredText?: string;
} {
  const requiredText = requiredTypedConfirmation(request);

  return {
    riskLevel: request.riskLevel,
    requiresSecondApproval: request.requiresSecondApproval,
    typedConfirmationRequired: Boolean(requiredText),
    requiredText
  };
}

export function createApprovalRequest(input: {
  context: UserContext;
  action: ApprovalAction;
  objectType: string;
  objectId?: string;
  beforeJson?: unknown;
  afterJson?: unknown;
  diffJson?: unknown;
  reason?: string;
}): ApprovalRequest {
  assertNoBudgetMutation(input);
  const policy = getApprovalPolicy(input.action);
  assertRole(input.context, policy.minimumRequesterRole);
  const now = new Date().toISOString();

  return {
    id: randomUUID(),
    tenantId: input.context.tenantId,
    createdAt: now,
    createdBy: input.context.userId,
    requestedBy: input.context.userId,
    action: input.action,
    riskLevel: policy.riskLevel,
    objectType: input.objectType,
    objectId: input.objectId,
    status: "pending",
    beforeJson: input.beforeJson,
    afterJson: input.afterJson,
    diffJson: input.diffJson,
    reason: input.reason,
    requiresSecondApproval: policy.requiresSecondApproval
  };
}

export function approveRequest(
  request: ApprovalRequest,
  approver: UserContext,
  options: ApprovalConfirmationOptions = {}
): ApprovalRequest {
  const policy = getApprovalPolicy(request.action);
  assertRole(approver, policy.executorRole);
  if (request.tenantId !== approver.tenantId) {
    throw new Error("TENANT_ACCESS_DENIED");
  }
  if (request.status !== "pending" && request.status !== "approved") {
    throw new Error("APPROVAL_NOT_PENDING");
  }
  if (request.requestedBy === approver.userId) {
    throw new Error("SELF_APPROVAL_NOT_ALLOWED");
  }

  const requiredConfirmation = requiredTypedConfirmation(request);
  if (requiredConfirmation && options.typedConfirmation?.trim() !== requiredConfirmation) {
    throw new TypedConfirmationRequiredError(requiredConfirmation);
  }

  if (request.requiresSecondApproval && request.status === "approved") {
    if (request.approvedBy === approver.userId) {
      throw new Error("DUPLICATE_SECOND_APPROVAL_NOT_ALLOWED");
    }
    return {
      ...request,
      secondApprovedBy: approver.userId
    };
  }

  return {
    ...request,
    status: "approved",
    approvedBy: approver.userId
  };
}

export function rejectRequest(request: ApprovalRequest, rejecter: UserContext, reason?: string): ApprovalRequest {
  if (request.tenantId !== rejecter.tenantId) {
    throw new Error("TENANT_ACCESS_DENIED");
  }
  return {
    ...request,
    status: "rejected",
    reason: reason ?? request.reason
  };
}

export function assertExecutableApproval(request: ApprovalRequest, executor: UserContext): void {
  const policy = getApprovalPolicy(request.action);
  assertRole(executor, policy.executorRole);
  if (request.tenantId !== executor.tenantId) {
    throw new Error("TENANT_ACCESS_DENIED");
  }
  if (request.status !== "approved") {
    throw new Error("APPROVAL_REQUIRED");
  }
  if (request.requiresSecondApproval && !request.secondApprovedBy) {
    throw new Error("SECOND_APPROVAL_REQUIRED");
  }
}

export function markExecuted(request: ApprovalRequest, executionResultJson?: unknown): ApprovalRequest {
  return {
    ...request,
    status: "executed",
    executionResultJson: executionResultJson ?? request.executionResultJson
  };
}
