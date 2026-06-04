import { describe, expect, it } from "vitest";
import { MemoryHermesRepository, costUsageFromEstimate } from "@/lib/repositories/hermes-repository";
import { createApprovalRequest } from "@/lib/approval/approval-policy";
import type { UserContext } from "@/lib/types";

const request = new Request("http://localhost/api/test");

const owner: UserContext = {
  userId: "user-owner",
  tenantId: "tenant-a",
  role: "owner"
};

const marketer: UserContext = {
  userId: "user-marketer",
  tenantId: "tenant-a",
  role: "marketer"
};

describe("Hermes repository", () => {
  it("keeps approval reads tenant-scoped in memory fallback", async () => {
    const repository = new MemoryHermesRepository();
    const approval = createApprovalRequest({
      context: marketer,
      action: "meta_create_ad_paused",
      objectType: "ad",
      afterJson: { status: "PAUSED" }
    });

    await repository.saveApproval(request, approval);

    await expect(repository.getApproval(request, owner, approval.id)).resolves.toEqual(approval);
    await expect(
      repository.getApproval(request, { ...owner, tenantId: "tenant-b" }, approval.id)
    ).resolves.toBeNull();
  });

  it("records cost usage estimates without executable budget fields", async () => {
    const repository = new MemoryHermesRepository();
    const usage = costUsageFromEstimate(
      {
        operationType: "image_generation",
        settings: {
          providerName: "higgsfield",
          creditUnitCostKrw: 100
        },
        estimatedCredits: 5
      },
      owner,
      500
    );

    await repository.saveCostUsage(request, usage);
    const usageList = await repository.listCostUsage(request, owner);

    expect(usageList).toHaveLength(1);
    expect(JSON.stringify(usageList)).not.toContain("daily_budget");
  });
});
