import { describe, expect, it } from "vitest";
import {
  MemoryHermesRepository,
  costUsageFromEstimate,
  requestAuditMetadata
} from "@/lib/repositories/hermes-repository";
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
  it("extracts audit IP and user agent from request headers", () => {
    const metadata = requestAuditMetadata(
      new Request("http://localhost/api/approvals", {
        headers: {
          "x-forwarded-for": "203.0.113.8, 10.0.0.1",
          "x-real-ip": "198.51.100.3",
          "user-agent": "HermesTest/1.0"
        }
      })
    );

    expect(metadata).toEqual({
      ipAddress: "203.0.113.8",
      userAgent: "HermesTest/1.0"
    });
  });

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

  it("adds request metadata to memory audit logs", async () => {
    const repository = new MemoryHermesRepository();
    const auditRequest = new Request("http://localhost/api/approvals", {
      headers: {
        "x-real-ip": "198.51.100.42",
        "user-agent": "HermesAudit/1.0"
      }
    });

    await repository.saveAuditLog(auditRequest, {
      tenantId: owner.tenantId,
      userId: owner.userId,
      action: "approval_requested:meta_create_ad_paused",
      objectType: "approval_request",
      result: "pending"
    });

    const auditStore = globalThis as typeof globalThis & {
      __hermesRepositoryStore?: { auditLogs?: unknown[] };
    };
    const auditLogs = auditStore.__hermesRepositoryStore?.auditLogs ?? [];
    expect(auditLogs.at(-1)).toMatchObject({
      ipAddress: "198.51.100.42",
      userAgent: "HermesAudit/1.0"
    });
  });
});
