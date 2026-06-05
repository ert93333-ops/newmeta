import { afterEach, describe, expect, it } from "vitest";
import { POST as requestDataDeletion } from "@/app/api/data-deletion-requests/route";
import { POST as approveApproval } from "@/app/api/approvals/[id]/approve/route";
import { POST as rejectApproval } from "@/app/api/approvals/[id]/reject/route";
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

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("data deletion approval lifecycle", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("syncs the stored deletion request when the destructive approval is approved", async () => {
    clearEnv();
    mutableEnv.HERMES_AUTH_MODE = "mock";

    const createResponse = await requestDataDeletion(
      new Request("http://localhost/api/data-deletion-requests", {
        method: "POST",
        body: JSON.stringify({ scope: "tenant" })
      })
    );
    const createBody = await json(createResponse);
    const approval = createBody.approval as { id: string };
    const deletionRequest = createBody.deletionRequest as { id: string };

    const approveResponse = await approveApproval(
      new Request(`http://localhost/api/approvals/${approval.id}/approve`, {
        method: "POST",
        body: JSON.stringify({ typedConfirmation: "APPROVE tenant_data_deletion" })
      }),
      { params: Promise.resolve({ id: approval.id }) }
    );
    const approveBody = await json(approveResponse);
    const repository = new MemoryHermesRepository();
    const storedDeletionRequest = await repository.getDataDeletionRequest(
      new Request("http://localhost/api/test"),
      mockContext,
      deletionRequest.id
    );

    expect(approveResponse.status).toBe(200);
    expect((approveBody.approval as { status?: string }).status).toBe("approved");
    expect(storedDeletionRequest).toMatchObject({
      id: deletionRequest.id,
      status: "approval_required"
    });
    expect(storedDeletionRequest?.resultJson).toMatchObject({
      approvalRequestId: approval.id,
      approvalStatus: "approved",
      approvedBy: "00000000-0000-0000-0000-000000000011",
      readyForExecution: false
    });
  });

  it("cancels the stored deletion request when the destructive approval is rejected", async () => {
    clearEnv();
    mutableEnv.HERMES_AUTH_MODE = "mock";

    const createResponse = await requestDataDeletion(
      new Request("http://localhost/api/data-deletion-requests", {
        method: "POST",
        body: JSON.stringify({ scope: "creative_assets" })
      })
    );
    const createBody = await json(createResponse);
    const approval = createBody.approval as { id: string };
    const deletionRequest = createBody.deletionRequest as { id: string };

    const rejectResponse = await rejectApproval(
      new Request(`http://localhost/api/approvals/${approval.id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: "Customer withdrew request." })
      }),
      { params: Promise.resolve({ id: approval.id }) }
    );
    const rejectBody = await json(rejectResponse);
    const repository = new MemoryHermesRepository();
    const storedDeletionRequest = await repository.getDataDeletionRequest(
      new Request("http://localhost/api/test"),
      mockContext,
      deletionRequest.id
    );

    expect(rejectResponse.status).toBe(200);
    expect((rejectBody.approval as { status?: string }).status).toBe("rejected");
    expect(storedDeletionRequest).toMatchObject({
      id: deletionRequest.id,
      status: "cancelled"
    });
    expect(storedDeletionRequest?.resultJson).toMatchObject({
      approvalRequestId: approval.id,
      approvalStatus: "rejected",
      rejectedBy: mockContext.userId,
      rejectionReason: "Customer withdrew request."
    });
  });
});
