import { describe, expect, it } from "vitest";
import {
  approvalGuardDetails,
  approvalExpiresAt,
  approveRequest,
  assertExecutableApproval,
  createApprovalRequest,
  requiredTypedConfirmation
} from "@/lib/approval/approval-policy";
import type { UserContext } from "@/lib/types";

const requester: UserContext = {
  userId: "user-requester",
  tenantId: "tenant-1",
  role: "marketer"
};

const approver: UserContext = {
  userId: "user-approver",
  tenantId: "tenant-1",
  role: "owner"
};

describe("approval policy", () => {
  it("assigns risk-based approval expiry timestamps", () => {
    const draft = createApprovalRequest({
      context: requester,
      action: "meta_create_ad_paused",
      objectType: "ad"
    });
    const publish = createApprovalRequest({
      context: requester,
      action: "meta_activate_ad",
      objectType: "ad"
    });
    const destructive = createApprovalRequest({
      context: { ...requester, role: "admin" },
      action: "meta_delete_ad",
      objectType: "ad"
    });

    expect(draft.expiresAt).toBe(approvalExpiresAt("draft", draft.createdAt));
    expect(publish.expiresAt).toBe(approvalExpiresAt("publish", publish.createdAt));
    expect(destructive.expiresAt).toBe(approvalExpiresAt("destructive", destructive.createdAt));
  });

  it("requires approval before execution", () => {
    const approval = createApprovalRequest({
      context: requester,
      action: "meta_create_ad_paused",
      objectType: "ad",
      afterJson: { status: "PAUSED" }
    });
    expect(() => assertExecutableApproval(approval, approver)).toThrow("APPROVAL_REQUIRED");
  });

  it("rejects unsupported approval actions at runtime", () => {
    expect(() =>
      createApprovalRequest({
        context: requester,
        action: "meta_scale_campaign" as never,
        objectType: "campaign"
      })
    ).toThrow("APPROVAL_ACTION_UNSUPPORTED");
  });

  it("allows execution after approval", () => {
    const approval = createApprovalRequest({
      context: requester,
      action: "meta_create_ad_paused",
      objectType: "ad",
      afterJson: { status: "PAUSED" }
    });
    const approved = approveRequest(approval, approver);
    expect(() => assertExecutableApproval(approved, approver)).not.toThrow();
  });

  it("blocks expired approvals before approval or execution", () => {
    const approval = createApprovalRequest({
      context: requester,
      action: "meta_create_ad_paused",
      objectType: "ad",
      afterJson: { status: "PAUSED" }
    });
    const expired = {
      ...approval,
      expiresAt: new Date(Date.now() - 1000).toISOString()
    };
    const approvedExpired = {
      ...approveRequest(approval, approver),
      expiresAt: new Date(Date.now() - 1000).toISOString()
    };

    expect(() => approveRequest(expired, approver)).toThrow("APPROVAL_EXPIRED");
    expect(() => assertExecutableApproval(approvedExpired, approver)).toThrow("APPROVAL_EXPIRED");
  });

  it("does not allow self approval", () => {
    const approval = createApprovalRequest({
      context: { ...requester, role: "owner" },
      action: "meta_activate_ad",
      objectType: "ad"
    });
    expect(() => approveRequest(approval, { ...requester, role: "owner" })).toThrow("SELF_APPROVAL_NOT_ALLOWED");
  });

  it("allows explicit self approval for draft paid AI generation requests", () => {
    const approval = createApprovalRequest({
      context: requester,
      action: "ai_paid_generation",
      objectType: "image_generation",
      objectId: "image-generation-1"
    });
    const approved = approveRequest(approval, requester);
    expect(approved.status).toBe("approved");
    expect(approved.approvedBy).toBe(requester.userId);
  });

  it("requires typed confirmation for publish approvals", () => {
    const approval = createApprovalRequest({
      context: requester,
      action: "meta_activate_ad",
      objectType: "ad",
      objectId: "ad-1"
    });

    expect(requiredTypedConfirmation(approval)).toBe("APPROVE meta_activate_ad");
    expect(() => approveRequest(approval, approver)).toThrow("TYPED_CONFIRMATION_REQUIRED");
    expect(() =>
      approveRequest(approval, approver, { typedConfirmation: "APPROVE meta_activate_ad" })
    ).not.toThrow();
  });

  it("requires typed confirmation on both destructive approvals", () => {
    const approval = createApprovalRequest({
      context: { ...requester, role: "admin" },
      action: "meta_delete_ad",
      objectType: "ad",
      objectId: "ad-1"
    });
    const firstApprover = { ...approver, userId: "owner-1" };
    const secondApprover = { ...approver, userId: "owner-2" };

    const approved = approveRequest(approval, firstApprover, { typedConfirmation: "APPROVE meta_delete_ad" });

    expect(() => approveRequest(approved, secondApprover)).toThrow("TYPED_CONFIRMATION_REQUIRED");
    expect(
      approveRequest(approved, secondApprover, { typedConfirmation: "APPROVE meta_delete_ad" }).secondApprovedBy
    ).toBe("owner-2");
  });

  it("treats Meta connection disconnects as destructive two-approval actions", () => {
    const approval = createApprovalRequest({
      context: { ...requester, role: "admin" },
      action: "meta_disconnect_connection",
      objectType: "meta_connection",
      objectId: "connection-1"
    });

    expect(approval.riskLevel).toBe("destructive");
    expect(approval.requiresSecondApproval).toBe(true);
    expect(requiredTypedConfirmation(approval)).toBe("APPROVE meta_disconnect_connection");
  });

  it("treats tenant data deletion as a destructive two-approval action", () => {
    const approval = createApprovalRequest({
      context: { ...requester, role: "admin" },
      action: "tenant_data_deletion",
      objectType: "data_deletion_request",
      objectId: "deletion-1"
    });

    expect(approval.riskLevel).toBe("destructive");
    expect(approval.requiresSecondApproval).toBe(true);
    expect(requiredTypedConfirmation(approval)).toBe("APPROVE tenant_data_deletion");
  });

  it("returns approval guard metadata for the UI", () => {
    const approval = createApprovalRequest({
      context: requester,
      action: "meta_activate_campaign",
      objectType: "campaign",
      objectId: "campaign-1"
    });

    expect(approvalGuardDetails(approval)).toEqual({
      riskLevel: "publish",
      requiresSecondApproval: false,
      typedConfirmationRequired: true,
      expiresAt: approval.expiresAt,
      requiredText: "APPROVE meta_activate_campaign"
    });
  });
});
