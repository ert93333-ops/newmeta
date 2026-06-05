import { afterEach, describe, expect, it } from "vitest";
import { approveRequest, createApprovalRequest } from "@/lib/approval/approval-policy";
import { POST as createPausedDraft } from "@/app/api/drafts/create-paused/route";
import { MemoryHermesRepository } from "@/lib/repositories/hermes-repository";
import type { CreativeManifest, UserContext } from "@/lib/types";

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
const tenantId = "00000000-0000-0000-0000-000000000001";
const requester: UserContext = {
  userId: "draft-requester",
  tenantId,
  role: "marketer"
};
const approver: UserContext = {
  userId: "draft-approver",
  tenantId,
  role: "owner"
};

const manifest: CreativeManifest = {
  asset: { type: "image", width: 1080, height: 1350 },
  linkUrl: "https://example.com/products/test",
  textBoxes: [
    {
      text: "Clear hook",
      x: 120,
      y: 150,
      width: 380,
      height: 80,
      role: "hook"
    },
    {
      text: "9,900",
      x: 120,
      y: 930,
      width: 220,
      height: 80,
      role: "price"
    },
    {
      text: "Shop now",
      x: 120,
      y: 1030,
      width: 220,
      height: 80,
      role: "cta"
    }
  ]
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

function setMockEnv(): void {
  clearEnv();
  mutableEnv.HERMES_AUTH_MODE = "mock";
  mutableEnv.HERMES_DEFAULT_TENANT_ID = tenantId;
}

function request(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/drafts/create-paused", {
    method: "POST",
    headers: {
      "x-tenant-id": tenantId
    },
    body: JSON.stringify(body)
  });
}

function approvedDraftApproval(draftId: string) {
  return approveRequest(
    createApprovalRequest({
      context: requester,
      action: "meta_create_ad_paused",
      objectType: "ad_draft",
      objectId: draftId,
      afterJson: {
        draftId,
        metaStatus: "PAUSED"
      }
    }),
    approver
  );
}

describe("create paused draft route", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("requires production authentication before creating draft approvals", async () => {
    clearEnv();
    mutableEnv.NODE_ENV = "production";

    const response = await createPausedDraft(
      request({
        manifest,
        pageId: "page_1"
      })
    );
    const body = (await response.json()) as { error?: { code?: string } };

    expect(response.status).toBe(401);
    expect(body.error?.code).toBe("SUPABASE_AUTH_REQUIRED");
  });

  it("creates a real approval request when preflight passes but no approval is supplied", async () => {
    setMockEnv();
    const repository = new MemoryHermesRepository();

    const response = await createPausedDraft(
      request({
        draftId: "draft-approval-1",
        manifest,
        pageId: "page_1",
        payload: {
          creativeName: "Summer promo"
        }
      })
    );
    const body = (await response.json()) as {
      status: string;
      draftId: string;
      approval: { id: string; action: string; status: string; objectId?: string };
      guard: { riskLevel: string; requiresSecondApproval: boolean; typedConfirmationRequired: boolean };
    };
    const stored = await repository.getApproval(request({}), requester, body.approval.id);

    expect(response.status).toBe(202);
    expect(body.status).toBe("approval_required");
    expect(body.draftId).toBe("draft-approval-1");
    expect(body.approval).toMatchObject({
      action: "meta_create_ad_paused",
      status: "pending",
      objectId: "draft-approval-1"
    });
    expect(body.guard).toMatchObject({
      riskLevel: "draft",
      requiresSecondApproval: false,
      typedConfirmationRequired: false
    });
    expect(stored?.objectId).toBe("draft-approval-1");
  });

  it("blocks draft creation when server-side preflight fails", async () => {
    setMockEnv();

    const response = await createPausedDraft(
      request({
        draftId: "draft-blocked-1",
        manifest
      })
    );
    const body = (await response.json()) as {
      error?: { code?: string; details?: { blockers?: string[] } };
    };

    expect(response.status).toBe(422);
    expect(body.error?.code).toBe("DRAFT_PREFLIGHT_BLOCKED");
    expect(body.error?.details?.blockers?.length).toBeGreaterThan(0);
  });

  it("creates and persists a paused draft only after approval, then consumes that approval", async () => {
    setMockEnv();
    const repository = new MemoryHermesRepository();
    const approval = approvedDraftApproval("draft-approved-1");
    await repository.saveApproval(request({}), approval);

    const response = await createPausedDraft(
      request({
        draftId: "draft-approved-1",
        approvalRequestId: approval.id,
        draftType: "ad",
        adAccountId: "act_123",
        assetId: "asset_123",
        manifest,
        pageId: "page_1",
        payload: {
          creativeName: "Approved paused draft"
        }
      })
    );
    const body = (await response.json()) as {
      draft: { id: string; approvalRequestId?: string; metaStatus: string; draftType: string };
      approval: { id: string; status: string; executionResultJson?: { result?: string } };
    };
    const storedDraft = await repository.getAdDraft(request({}), requester, "draft-approved-1");
    const storedApproval = await repository.getApproval(request({}), requester, approval.id);

    expect(response.status).toBe(201);
    expect(body.draft).toMatchObject({
      id: "draft-approved-1",
      approvalRequestId: approval.id,
      metaStatus: "PAUSED",
      draftType: "ad"
    });
    expect(body.approval).toMatchObject({
      id: approval.id,
      status: "executed",
      executionResultJson: {
        result: "paused_draft_created"
      }
    });
    expect(storedDraft?.approvalRequestId).toBe(approval.id);
    expect(storedApproval?.status).toBe("executed");
  });

  it("does not allow the same paused-draft approval to be reused", async () => {
    setMockEnv();
    const repository = new MemoryHermesRepository();
    const approval = approvedDraftApproval("draft-approved-reuse");
    await repository.saveApproval(request({}), approval);

    await createPausedDraft(
      request({
        draftId: "draft-approved-reuse",
        approvalRequestId: approval.id,
        manifest,
        pageId: "page_1"
      })
    );
    const secondResponse = await createPausedDraft(
      request({
        draftId: "draft-approved-reuse",
        approvalRequestId: approval.id,
        manifest,
        pageId: "page_1"
      })
    );
    const secondBody = (await secondResponse.json()) as { error?: { code?: string } };

    expect(secondResponse.status).toBe(403);
    expect(secondBody.error?.code).toBe("APPROVAL_REQUIRED");
  });
});
