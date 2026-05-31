import { describe, expect, it } from "vitest";
import { approveRequest, createApprovalRequest } from "@/lib/approval/approval-policy";
import { MockMetaAdapter } from "@/lib/meta/mock-meta-adapter";
import type { UserContext } from "@/lib/types";

const requester: UserContext = {
  userId: "requester",
  tenantId: "00000000-0000-0000-0000-000000000001",
  role: "marketer"
};

const approver: UserContext = {
  userId: "approver",
  tenantId: "00000000-0000-0000-0000-000000000001",
  role: "owner"
};

describe("MockMetaAdapter", () => {
  it("creates only PAUSED ads after approval", async () => {
    const adapter = new MockMetaAdapter();
    const approval = approveRequest(
      createApprovalRequest({
        context: requester,
        action: "meta_create_ad_paused",
        objectType: "ad",
        afterJson: { status: "PAUSED" }
      }),
      approver
    );
    const result = await adapter.createAdPaused({
      adAccountId: "act_mock_001",
      adsetId: "adset_mock_001",
      name: "mock ad",
      creativeId: "creative_mock_001",
      approval
    });
    expect(result.status).toBe("PAUSED");
  });
});
