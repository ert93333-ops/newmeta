import { afterEach, describe, expect, it } from "vitest";
import { GET as listDataDeletionRequests } from "@/app/api/data-deletion-requests/route";
import { POST as requestDataDeletion } from "@/app/api/data-deletion-requests/route";
import { MemoryHermesRepository } from "@/lib/repositories/hermes-repository";
import type { UserContext } from "@/lib/types";

const ENV_KEYS = [
  "NODE_ENV",
  "VERCEL_ENV",
  "HERMES_AUTH_MODE",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
] as const;

const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const mutableEnv = process.env as unknown as Record<string, string | undefined>;
const tenantId = "00000000-0000-0000-0000-000000000001";
const mockContext: UserContext = {
  userId: "00000000-0000-0000-0000-000000000010",
  tenantId,
  role: "owner"
};

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

function resetMemoryStore(): void {
  delete (globalThis as typeof globalThis & { __hermesRepositoryStore?: unknown }).__hermesRepositoryStore;
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("data deletion request route", () => {
  afterEach(() => {
    restoreEnv();
    resetMemoryStore();
  });

  it("requires production authentication before listing deletion requests", async () => {
    clearEnv();
    mutableEnv.NODE_ENV = "production";

    const response = await listDataDeletionRequests(
      new Request("http://localhost/api/data-deletion-requests", {
        method: "GET"
      })
    );
    const body = await json(response);

    expect(response.status).toBe(401);
    expect((body.error as { code?: string }).code).toBe("SUPABASE_AUTH_REQUIRED");
  });

  it("requires production authentication before creating a deletion approval", async () => {
    clearEnv();
    mutableEnv.NODE_ENV = "production";

    const response = await requestDataDeletion(
      new Request("http://localhost/api/data-deletion-requests", {
        method: "POST"
      })
    );
    const body = await json(response);

    expect(response.status).toBe(401);
    expect((body.error as { code?: string }).code).toBe("SUPABASE_AUTH_REQUIRED");
  });

  it("creates a destructive approval instead of queueing tenant data deletion", async () => {
    clearEnv();
    mutableEnv.HERMES_AUTH_MODE = "mock";

    const response = await requestDataDeletion(
      new Request("http://localhost/api/data-deletion-requests", {
        method: "POST",
        body: JSON.stringify({
          scope: "meta_integration",
          reason: "Customer requested account disconnect and data removal."
        })
      })
    );
    const body = await json(response);
    const approval = body.approval as { id: string; action: string; status: string; riskLevel: string };
    const deletionRequest = body.deletionRequest as { id: string; status: string; scope: string; resultJson?: Record<string, unknown> };
    const repository = new MemoryHermesRepository();
    const storedApproval = await repository.getApproval(
      new Request("http://localhost/api/test"),
      mockContext,
      approval.id
    );
    const storedDeletionRequest = await repository.getDataDeletionRequest(
      new Request("http://localhost/api/test"),
      mockContext,
      deletionRequest.id
    );

    expect(response.status).toBe(202);
    expect(deletionRequest).toMatchObject({
      status: "approval_required",
      scope: "meta_integration"
    });
    expect(body).toMatchObject({
      guard: {
        riskLevel: "destructive",
        requiresSecondApproval: true,
        typedConfirmationRequired: true,
        requiredText: "APPROVE tenant_data_deletion"
      }
    });
    expect(approval).toMatchObject({
      action: "tenant_data_deletion",
      status: "pending",
      riskLevel: "destructive"
    });
    expect(storedApproval?.objectId).toBe(deletionRequest.id);
    expect(storedDeletionRequest).toMatchObject({
      id: deletionRequest.id,
      scope: "meta_integration",
      status: "approval_required",
      requestedBy: mockContext.userId
    });
    expect(storedDeletionRequest?.resultJson).toMatchObject({
      approvalStatus: "pending",
      approvalRequestId: approval.id
    });
    expect(JSON.stringify(body)).not.toContain("\"queued\"");
    expect(JSON.stringify(body)).not.toContain("encrypted_access_token");
  });

  it("lists tenant-scoped data deletion requests with lifecycle metadata", async () => {
    clearEnv();
    mutableEnv.HERMES_AUTH_MODE = "mock";

    await requestDataDeletion(
      new Request("http://localhost/api/data-deletion-requests", {
        method: "POST",
        body: JSON.stringify({
          scope: "tenant",
          reason: "Primary tenant deletion request."
        })
      })
    );
    const repository = new MemoryHermesRepository();
    await repository.saveDataDeletionRequest(new Request("http://localhost/api/test"), {
      id: "cross-tenant-request",
      tenantId: "00000000-0000-0000-0000-000000000099",
      createdBy: "other-user",
      requestedBy: "other-user",
      scope: "tenant",
      status: "approval_required",
      resultJson: {
        approvalStatus: "pending"
      }
    });

    const response = await listDataDeletionRequests(
      new Request("http://localhost/api/data-deletion-requests?limit=10", {
        method: "GET"
      })
    );
    const body = await json(response);
    const deletionRequests = body.deletionRequests as Array<{
      tenantId: string;
      scope: string;
      status: string;
      resultJson?: Record<string, unknown>;
    }>;

    expect(response.status).toBe(200);
    expect(deletionRequests).toHaveLength(1);
    expect(deletionRequests[0]).toMatchObject({
      tenantId,
      scope: "tenant",
      status: "approval_required"
    });
    expect(deletionRequests[0].resultJson).toMatchObject({
      approvalStatus: "pending"
    });
  });

  it("hard-blocks budget mutation payloads on deletion requests", async () => {
    clearEnv();
    mutableEnv.HERMES_AUTH_MODE = "mock";

    const response = await requestDataDeletion(
      new Request("http://localhost/api/data-deletion-requests", {
        method: "POST",
        body: JSON.stringify({ daily_budget: 50000 })
      })
    );
    const body = await json(response);

    expect(response.status).toBe(403);
    expect((body.error as { code?: string }).code).toBe("BUDGET_MUTATION_HARD_BLOCKED");
  });
});
