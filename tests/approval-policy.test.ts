import { describe, expect, it } from "vitest";
import { approveRequest, assertExecutableApproval, createApprovalRequest } from "@/lib/approval/approval-policy";
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
  it("requires approval before execution", () => {
    const approval = createApprovalRequest({
      context: requester,
      action: "meta_create_ad_paused",
      objectType: "ad",
      afterJson: { status: "PAUSED" }
    });
    expect(() => assertExecutableApproval(approval, approver)).toThrow("APPROVAL_REQUIRED");
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

  it("does not allow self approval", () => {
    const approval = createApprovalRequest({
      context: { ...requester, role: "owner" },
      action: "meta_activate_ad",
      objectType: "ad"
    });
    expect(() => approveRequest(approval, { ...requester, role: "owner" })).toThrow("SELF_APPROVAL_NOT_ALLOWED");
  });
});
