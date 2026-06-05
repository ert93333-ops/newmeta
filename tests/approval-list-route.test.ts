import { afterEach, describe, expect, it } from "vitest";
import { GET as listApprovals } from "@/app/api/approvals/route";
import { createApprovalRequest } from "@/lib/approval/approval-policy";
import { MemoryHermesRepository } from "@/lib/repositories/hermes-repository";
import type { UserContext } from "@/lib/types";

const ENV_KEYS = [
  "NODE_ENV",
  "VERCEL_ENV",
  "HERMES_AUTH_MODE",
  "HERMES_DEFAULT_TENANT_ID",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
] as const;

const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const mutableEnv = process.env as unknown as Record<string, string | undefined>;
const tenantId = "10000000-0000-0000-0000-000000000111";
const otherTenantId = "10000000-0000-0000-0000-000000000222";

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = ORIGINAL_ENV[key];
    if (value === undefined) {
      delete mutableEnv[key];
    } else {
      mutableEnv[key] = value;
    }
  }
}

function clearEnv(): void {
  for (const key of ENV_KEYS) {
    delete mutableEnv[key];
  }
}

function context(tenant: string, role: UserContext["role"] = "owner"): UserContext {
  return {
    userId: `user-${tenant}`,
    tenantId: tenant,
    role
  };
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("approval list route", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("requires production authentication before listing approvals", async () => {
    clearEnv();
    mutableEnv.NODE_ENV = "production";

    const response = await listApprovals(new Request("http://localhost/api/approvals"));
    const body = await json(response);

    expect(response.status).toBe(401);
    expect((body.error as { code?: string }).code).toBe("SUPABASE_AUTH_REQUIRED");
  });

  it("lists only tenant approvals with guard metadata and redacted credential fields", async () => {
    clearEnv();
    mutableEnv.HERMES_AUTH_MODE = "mock";
    mutableEnv.HERMES_DEFAULT_TENANT_ID = tenantId;
    const repository = new MemoryHermesRepository();
    const draftApproval = {
      ...createApprovalRequest({
        context: context(tenantId, "marketer"),
        action: "meta_create_ad_paused",
        objectType: "ad",
        objectId: "ad-list-1",
        afterJson: {
          status: "PAUSED",
          encryptedAccessToken: "must-not-leave-server"
        }
      }),
      createdAt: "2026-06-05T01:00:00.000Z"
    };
    const destructiveApproval = {
      ...createApprovalRequest({
        context: context(tenantId, "admin"),
        action: "tenant_data_deletion",
        objectType: "data_deletion_request",
        objectId: "deletion-list-1"
      }),
      createdAt: "2026-06-05T02:00:00.000Z"
    };
    const otherTenantApproval = createApprovalRequest({
      context: context(otherTenantId, "marketer"),
      action: "meta_create_ad_paused",
      objectType: "ad",
      objectId: "other-tenant-ad"
    });

    await repository.saveApproval(new Request("http://localhost/api/test"), draftApproval);
    await repository.saveApproval(new Request("http://localhost/api/test"), destructiveApproval);
    await repository.saveApproval(new Request("http://localhost/api/test"), otherTenantApproval);

    const response = await listApprovals(
      new Request("http://localhost/api/approvals", {
        headers: {
          "x-tenant-id": tenantId
        }
      })
    );
    const body = await json(response);
    const approvals = body.approvals as Array<{
      approval: { id: string; tenantId: string; action: string; afterJson?: Record<string, unknown> };
      guard: { riskLevel: string; requiresSecondApproval: boolean; requiredText?: string };
    }>;
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(approvals.map((item) => item.approval.id)).toEqual([destructiveApproval.id, draftApproval.id]);
    expect(approvals.every((item) => item.approval.tenantId === tenantId)).toBe(true);
    expect(approvals[0].guard).toMatchObject({
      riskLevel: "destructive",
      requiresSecondApproval: true,
      requiredText: "APPROVE tenant_data_deletion"
    });
    expect(serialized).not.toContain(otherTenantApproval.id);
    expect(serialized).not.toContain("must-not-leave-server");
    expect(approvals[1].approval.afterJson?.encryptedAccessToken).toBe("[REDACTED_CREDENTIAL_FIELD]");
  });
});
