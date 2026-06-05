import { describe, expect, it } from "vitest";
import {
  MemoryHermesRepository,
  costUsageFromEstimate,
  costUsageFromExecutedApproval,
  requestAuditMetadata,
  summarizeCostUsageRows
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

  it("summarizes tenant cost usage by server-side created time", async () => {
    const repository = new MemoryHermesRepository();
    const summaryOwner = {
      ...owner,
      tenantId: "tenant-summary"
    };
    const now = new Date("2026-06-05T09:00:00.000Z");
    await repository.saveCostUsage(request, {
      tenantId: summaryOwner.tenantId,
      userId: summaryOwner.userId,
      provider: "mock-ai",
      operationType: "image_generation",
      estimatedCredits: 10,
      estimatedCostKrw: 1000,
      status: "estimated",
      createdAt: "2026-06-05T08:00:00.000Z"
    });
    await repository.saveCostUsage(request, {
      tenantId: summaryOwner.tenantId,
      userId: summaryOwner.userId,
      provider: "mock-ai",
      operationType: "video_generation",
      estimatedCredits: 30,
      estimatedCostKrw: 3000,
      actualCostKrw: 2500,
      status: "succeeded",
      createdAt: "2026-06-04T08:00:00.000Z"
    });
    await repository.saveCostUsage(request, {
      tenantId: "tenant-summary-other",
      userId: summaryOwner.userId,
      provider: "mock-ai",
      operationType: "image_generation",
      estimatedCredits: 50,
      estimatedCostKrw: 5000,
      status: "estimated",
      createdAt: "2026-06-05T08:00:00.000Z"
    });

    await expect(repository.summarizeCostUsage(request, summaryOwner, now)).resolves.toEqual({
      todayActualCostKrw: 1000,
      monthActualCostKrw: 3500
    });
  });

  it("summarizes raw cost rows from Supabase snake_case fields", () => {
    expect(
      summarizeCostUsageRows(
        [
          {
            created_at: "2026-06-05T01:00:00.000Z",
            estimated_cost_krw: "700",
            status: "estimated"
          },
          {
            created_at: "2026-06-04T01:00:00.000Z",
            estimated_cost_krw: "300",
            actual_cost_krw: "200",
            status: "succeeded"
          },
          {
            created_at: "2026-06-05T01:00:00.000Z",
            estimated_cost_krw: "999",
            status: "failed"
          }
        ],
        new Date("2026-06-05T09:00:00.000Z")
      )
    ).toEqual({
      todayActualCostKrw: 700,
      monthActualCostKrw: 900
    });
  });

  it("counts the final actual cost once when estimate and execution share a related job", () => {
    expect(
      summarizeCostUsageRows(
        [
          {
            related_job_id: "approval-1",
            created_at: "2026-06-05T01:00:00.000Z",
            estimated_cost_krw: "500",
            status: "estimated"
          },
          {
            related_job_id: "approval-1",
            created_at: "2026-06-05T02:00:00.000Z",
            estimated_cost_krw: "500",
            actual_cost_krw: "450",
            status: "succeeded"
          }
        ],
        new Date("2026-06-05T09:00:00.000Z")
      )
    ).toEqual({
      todayActualCostKrw: 450,
      monthActualCostKrw: 450
    });
  });

  it("creates succeeded cost usage from an executed paid approval", () => {
    const approval = createApprovalRequest({
      context: marketer,
      action: "ai_paid_generation",
      objectType: "variant_batch",
      objectId: "creative-control-1",
      afterJson: {
        operationType: "variant_batch",
        providerName: "mock-ai",
        model: "mock-variant",
        estimatedCredits: 5,
        estimatedCostKrw: 500
      }
    });

    expect(costUsageFromExecutedApproval(approval, owner)).toMatchObject({
      tenantId: owner.tenantId,
      userId: owner.userId,
      provider: "mock-ai",
      model: "mock-variant",
      operationType: "variant_batch",
      estimatedCredits: 5,
      actualCredits: 5,
      estimatedCostKrw: 500,
      actualCostKrw: 500,
      relatedJobId: approval.id,
      status: "succeeded"
    });
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

  it("redacts credential-shaped fields from audit JSON payloads", async () => {
    const repository = new MemoryHermesRepository();

    await repository.saveAuditLog(request, {
      tenantId: owner.tenantId,
      userId: owner.userId,
      action: "approval_requested:meta_create_ad_paused",
      objectType: "approval_request",
      beforeJson: {
        access_token: "must-not-enter-audit-log",
        encryptedAccessToken: "must-not-enter-audit-log"
      },
      afterJson: {
        nested: {
          clientSecret: "must-not-enter-audit-log",
          tokenAuthTag: "must-not-enter-audit-log"
        }
      },
      result: "pending"
    });

    const auditStore = globalThis as typeof globalThis & {
      __hermesRepositoryStore?: { auditLogs?: unknown[] };
    };
    const auditLogs = auditStore.__hermesRepositoryStore?.auditLogs ?? [];
    const latestAudit = auditLogs.at(-1) as {
      beforeJson?: Record<string, unknown>;
      afterJson?: { nested?: Record<string, unknown> };
    };
    const serialized = JSON.stringify(latestAudit);

    expect(serialized).not.toContain("must-not-enter-audit-log");
    expect(latestAudit.beforeJson?.access_token).toBe("[REDACTED_CREDENTIAL_FIELD]");
    expect(latestAudit.beforeJson?.encryptedAccessToken).toBe("[REDACTED_CREDENTIAL_FIELD]");
    expect(latestAudit.afterJson?.nested?.clientSecret).toBe("[REDACTED_CREDENTIAL_FIELD]");
    expect(latestAudit.afterJson?.nested?.tokenAuthTag).toBe("[REDACTED_CREDENTIAL_FIELD]");
  });
});
