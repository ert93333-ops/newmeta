import { afterEach, describe, expect, it, vi } from "vitest";
import { approveRequest, createApprovalRequest } from "@/lib/approval/approval-policy";
import { POST as createPausedDraft } from "@/app/api/drafts/create-paused/route";
import { MemoryHermesRepository } from "@/lib/repositories/hermes-repository";
import { encryptToken } from "@/lib/security/token-crypto";
import type { CreativeManifest, UserContext } from "@/lib/types";

const ENV_KEYS = [
  "NODE_ENV",
  "VERCEL_ENV",
  "HERMES_AUTH_MODE",
  "HERMES_DEFAULT_TENANT_ID",
  "TOKEN_ENCRYPTION_KEY",
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
    vi.unstubAllGlobals();
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
    await repository.saveAsset(request({}), {
      id: "asset-approval-1",
      tenantId,
      createdBy: requester.userId,
      assetType: "image",
      width: 1080,
      height: 1350,
      mimeType: "image/png",
      metadataJson: {}
    });

    const response = await createPausedDraft(
      request({
        draftId: "draft-approval-1",
        adAccountId: "act_approval_1",
        assetId: "asset-approval-1",
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

  it("fails closed before creating approval when no persisted asset id is supplied", async () => {
    setMockEnv();
    const repository = new MemoryHermesRepository();

    const response = await createPausedDraft(
      request({
        draftId: "draft-missing-asset-before-approval",
        adAccountId: "act_missing_asset",
        manifest,
        pageId: "page_1"
      })
    );
    const body = (await response.json()) as { error?: { code?: string } };
    const approvals = await repository.listApprovals(request({}), requester);

    expect(response.status).toBe(400);
    expect(body.error?.code).toBe("CREATIVE_ASSET_ID_REQUIRED");
    expect(approvals.find((item) => item.objectId === "draft-missing-asset-before-approval")).toBeUndefined();
  });

  it("fails closed before creating approval when the Meta ad account id is missing", async () => {
    setMockEnv();
    const repository = new MemoryHermesRepository();
    await repository.saveAsset(request({}), {
      id: "asset-missing-adaccount-before-approval",
      tenantId,
      createdBy: requester.userId,
      assetType: "image",
      width: 1080,
      height: 1350,
      mimeType: "image/png",
      metadataJson: {}
    });

    const response = await createPausedDraft(
      request({
        draftId: "draft-missing-adaccount-before-approval",
        assetId: "asset-missing-adaccount-before-approval",
        manifest,
        pageId: "page_1"
      })
    );
    const body = (await response.json()) as { error?: { code?: string } };
    const approvals = await repository.listApprovals(request({}), requester);

    expect(response.status).toBe(400);
    expect(body.error?.code).toBe("META_AD_ACCOUNT_REQUIRED");
    expect(approvals.find((item) => item.objectId === "draft-missing-adaccount-before-approval")).toBeUndefined();
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
    await repository.saveAsset(request({}), {
      id: "asset_123",
      tenantId,
      createdBy: requester.userId,
      assetType: "image",
      width: 1080,
      height: 1350,
      mimeType: "image/png",
      metadataJson: {
        fileSizeBytes: 2048
      }
    });

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
      draftType: "ad",
      metaCampaignId: expect.stringMatching(/^cmp_/),
      metaAdsetId: expect.stringMatching(/^adset_/),
      metaAdId: expect.stringMatching(/^ad_/)
    });
    expect(body.approval).toMatchObject({
      id: approval.id,
      status: "executed",
      executionResultJson: {
        result: "paused_draft_created",
        adapterMode: "mock",
        creativeId: expect.stringMatching(/^creative_/)
      }
    });
    expect(storedDraft?.approvalRequestId).toBe(approval.id);
    expect(storedDraft?.metaCampaignId).toMatch(/^cmp_/);
    expect(storedApproval?.status).toBe("executed");
  });

  it("does not allow the same paused-draft approval to be reused", async () => {
    setMockEnv();
    const repository = new MemoryHermesRepository();
    const approval = approvedDraftApproval("draft-approved-reuse");
    await repository.saveApproval(request({}), approval);
    await repository.saveAsset(request({}), {
      id: "asset-reuse-1",
      tenantId,
      createdBy: requester.userId,
      assetType: "image",
      width: 1080,
      height: 1350,
      mimeType: "image/png",
      metadataJson: {}
    });

    await createPausedDraft(
      request({
        draftId: "draft-approved-reuse",
        approvalRequestId: approval.id,
        adAccountId: "act_123",
        assetId: "asset-reuse-1",
        manifest,
        pageId: "page_1"
      })
    );
    const secondResponse = await createPausedDraft(
      request({
        draftId: "draft-approved-reuse",
        approvalRequestId: approval.id,
        adAccountId: "act_123",
        assetId: "asset-reuse-1",
        manifest,
        pageId: "page_1"
      })
    );
    const secondBody = (await secondResponse.json()) as { error?: { code?: string } };

    expect(secondResponse.status).toBe(403);
    expect(secondBody.error?.code).toBe("APPROVAL_REQUIRED");
  });

  it("fails closed when the approved draft references a missing persisted asset", async () => {
    setMockEnv();
    const repository = new MemoryHermesRepository();
    const approval = approvedDraftApproval("draft-missing-asset");
    await repository.saveApproval(request({}), approval);

    const response = await createPausedDraft(
      request({
        draftId: "draft-missing-asset",
        approvalRequestId: approval.id,
        adAccountId: "act_123",
        assetId: "asset-missing-1",
        manifest,
        pageId: "page_1"
      })
    );
    const body = (await response.json()) as { error?: { code?: string } };

    expect(response.status).toBe(404);
    expect(body.error?.code).toBe("CREATIVE_ASSET_NOT_FOUND");
  });

  it("fails closed for live draft execution when the persisted asset lacks a public source URL", async () => {
    setMockEnv();
    const repository = new MemoryHermesRepository();
    const approval = approvedDraftApproval("draft-live-missing-source");
    await repository.saveApproval(request({}), approval);
    await repository.saveAsset(request({}), {
      id: "asset-live-missing-source",
      tenantId,
      createdBy: requester.userId,
      assetType: "image",
      width: 1080,
      height: 1350,
      mimeType: "image/png",
      metadataJson: {}
    });
    mutableEnv.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64");
    const encrypted = encryptToken("server-token", mutableEnv.TOKEN_ENCRYPTION_KEY, "primary");
    await repository.saveMetaConnection(request({}), {
      id: "meta-live-draft-1",
      tenantId,
      createdBy: requester.userId,
      provider: "meta",
      connectionMode: "oauth",
      encryptedAccessToken: encrypted.encryptedAccessToken,
      tokenIv: encrypted.tokenIv,
      tokenAuthTag: encrypted.tokenAuthTag,
      tokenKid: encrypted.tokenKid,
      scopes: ["ads_read", "ads_management", "business_management"],
      status: "connected",
      metadataJson: {
        mode: "live"
      }
    });

    const response = await createPausedDraft(
      request({
        draftId: "draft-live-missing-source",
        approvalRequestId: approval.id,
        adAccountId: "act_live_123",
        assetId: "asset-live-missing-source",
        manifest,
        pageId: "page_1"
      })
    );
    const body = (await response.json()) as { error?: { code?: string } };
    const storedApproval = await repository.getApproval(request({}), requester, approval.id);
    const storedDraft = await repository.getAdDraft(request({}), requester, "draft-live-missing-source");

    expect(response.status).toBe(422);
    expect(body.error?.code).toBe("META_ASSET_SOURCE_URL_REQUIRED");
    expect(storedApproval?.status).toBe("approved");
    expect(storedDraft).toBeNull();
  });

  it("cancels the approval and records partial Meta ids when live execution fails after side effects", async () => {
    setMockEnv();
    const repository = new MemoryHermesRepository();
    const approval = approvedDraftApproval("draft-live-partial-failure");
    await repository.saveApproval(request({}), approval);
    await repository.saveAsset(request({}), {
      id: "asset-live-partial-failure",
      tenantId,
      createdBy: requester.userId,
      assetType: "image",
      width: 1080,
      height: 1350,
      mimeType: "image/png",
      sourceUrl: "https://cdn.example.com/assets/live-partial-failure.png",
      metadataJson: {}
    });
    mutableEnv.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 16).toString("base64");
    const encrypted = encryptToken("server-token", mutableEnv.TOKEN_ENCRYPTION_KEY, "primary");
    await repository.saveMetaConnection(request({}), {
      id: "meta-live-partial-failure",
      tenantId,
      createdBy: requester.userId,
      provider: "meta",
      connectionMode: "oauth",
      encryptedAccessToken: encrypted.encryptedAccessToken,
      tokenIv: encrypted.tokenIv,
      tokenAuthTag: encrypted.tokenAuthTag,
      tokenKid: encrypted.tokenKid,
      scopes: ["ads_read", "ads_management", "business_management"],
      status: "connected",
      metadataJson: {
        mode: "live"
      }
    });

    const fetchMock = vi
      .fn(async () => Response.json({ images: { "live-partial-failure.png": { hash: "hash_live_partial" } } }))
      .mockImplementationOnce(async () =>
        Response.json({
          images: {
            "live-partial-failure.png": {
              hash: "hash_live_partial"
            }
          }
        })
      )
      .mockImplementationOnce(async () => Response.json({ id: "creative_live_partial" }))
      .mockImplementationOnce(async () => Response.json({ success: true }))
      .mockImplementationOnce(async () => Response.json({ id: "cmp_live_partial" }))
      .mockImplementationOnce(async () => Response.json({ success: true }))
      .mockImplementationOnce(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                message: "Ad set rejected by provider",
                type: "OAuthException",
                code: 100,
                error_subcode: 1815758
              }
            }),
            { status: 400 }
          )
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await createPausedDraft(
      request({
        draftId: "draft-live-partial-failure",
        approvalRequestId: approval.id,
        adAccountId: "act_live_123",
        assetId: "asset-live-partial-failure",
        manifest,
        pageId: "page_1",
        payload: {
          campaignName: "Live campaign",
          adsetName: "Live adset",
          adName: "Live ad",
          creativeName: "Live creative",
          objective: "OUTCOME_SALES",
          optimizationGoal: "OFFSITE_CONVERSIONS",
          targeting: {
            geo_locations: {
              countries: ["KR"]
            }
          },
          promotedObject: {
            pixel_id: "pixel_123",
            custom_event_type: "PURCHASE"
          },
          billingEvent: "IMPRESSIONS",
          bidStrategy: "LOWEST_COST_WITHOUT_CAP",
          headline: "Hook",
          description: "Description",
          message: "Primary text",
          callToActionType: "SHOP_NOW"
        }
      })
    );
    const body = (await response.json()) as {
      error?: {
        code?: string;
        details?: {
          partialExecution?: {
            imageHash?: string;
            creativeId?: string;
            campaignId?: string;
          };
          approval?: {
            id?: string;
            status?: string;
          };
        };
      };
    };
    const storedApproval = await repository.getApproval(request({}), requester, approval.id);
    const storedDraft = await repository.getAdDraft(request({}), requester, "draft-live-partial-failure");

    expect(response.status).toBe(400);
    expect(body.error?.code).toBe("META_GRAPH_REQUEST_FAILED");
    expect(body.error?.details?.partialExecution).toMatchObject({
      imageHash: "hash_live_partial",
      creativeId: "creative_live_partial",
      campaignId: "cmp_live_partial"
    });
    expect(body.error?.details?.approval).toMatchObject({
      id: approval.id,
      status: "cancelled"
    });
    expect(storedApproval).toMatchObject({
      status: "cancelled",
      executionResultJson: {
        result: "paused_draft_create_failed_partial",
        imageHash: "hash_live_partial",
        creativeId: "creative_live_partial",
        campaignId: "cmp_live_partial",
        errorCode: "META_GRAPH_REQUEST_FAILED"
      }
    });
    expect(storedDraft).toBeNull();
  });

  it("fails closed before creating approval when a live asset lacks a public source URL", async () => {
    setMockEnv();
    const repository = new MemoryHermesRepository();
    await repository.saveAsset(request({}), {
      id: "asset-live-missing-source-before-approval",
      tenantId,
      createdBy: requester.userId,
      assetType: "image",
      width: 1080,
      height: 1350,
      mimeType: "image/png",
      metadataJson: {}
    });
    mutableEnv.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 13).toString("base64");
    const encrypted = encryptToken("server-token", mutableEnv.TOKEN_ENCRYPTION_KEY, "primary");
    await repository.saveMetaConnection(request({}), {
      id: "meta-live-draft-before-approval",
      tenantId,
      createdBy: requester.userId,
      provider: "meta",
      connectionMode: "oauth",
      encryptedAccessToken: encrypted.encryptedAccessToken,
      tokenIv: encrypted.tokenIv,
      tokenAuthTag: encrypted.tokenAuthTag,
      tokenKid: encrypted.tokenKid,
      scopes: ["ads_read", "ads_management", "business_management"],
      status: "connected",
      metadataJson: {
        mode: "live"
      }
    });

    const response = await createPausedDraft(
      request({
        draftId: "draft-live-missing-source-before-approval",
        adAccountId: "act_live_123",
        assetId: "asset-live-missing-source-before-approval",
        manifest,
        pageId: "page_1"
      })
    );
    const body = (await response.json()) as { error?: { code?: string } };
    const approvals = await repository.listApprovals(request({}), requester);

    expect(response.status).toBe(422);
    expect(body.error?.code).toBe("META_ASSET_SOURCE_URL_REQUIRED");
    expect(approvals.find((item) => item.objectId === "draft-live-missing-source-before-approval")).toBeUndefined();
  });

  it("fails closed before creating approval when a live offsite-conversion draft lacks promotedObject", async () => {
    setMockEnv();
    const repository = new MemoryHermesRepository();
    await repository.saveAsset(request({}), {
      id: "asset-live-missing-promoted-object",
      tenantId,
      createdBy: requester.userId,
      assetType: "image",
      width: 1080,
      height: 1350,
      mimeType: "image/png",
      sourceUrl: "https://cdn.example.com/assets/live-missing-promoted-object.png",
      metadataJson: {}
    });
    mutableEnv.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 14).toString("base64");
    const encrypted = encryptToken("server-token", mutableEnv.TOKEN_ENCRYPTION_KEY, "primary");
    await repository.saveMetaConnection(request({}), {
      id: "meta-live-draft-missing-promoted-object",
      tenantId,
      createdBy: requester.userId,
      provider: "meta",
      connectionMode: "oauth",
      encryptedAccessToken: encrypted.encryptedAccessToken,
      tokenIv: encrypted.tokenIv,
      tokenAuthTag: encrypted.tokenAuthTag,
      tokenKid: encrypted.tokenKid,
      scopes: ["ads_read", "ads_management", "business_management"],
      status: "connected",
      metadataJson: {
        mode: "live"
      }
    });

    const response = await createPausedDraft(
      request({
        draftId: "draft-live-missing-promoted-object",
        adAccountId: "act_live_123",
        assetId: "asset-live-missing-promoted-object",
        manifest,
        pageId: "page_1",
        payload: {
          objective: "OUTCOME_SALES",
          optimizationGoal: "OFFSITE_CONVERSIONS",
          targeting: {
            geo_locations: {
              countries: ["KR"]
            }
          }
        }
      })
    );
    const body = (await response.json()) as { error?: { code?: string } };
    const approvals = await repository.listApprovals(request({}), requester);

    expect(response.status).toBe(422);
    expect(body.error?.code).toBe("META_PROMOTED_OBJECT_REQUIRED");
    expect(approvals.find((item) => item.objectId === "draft-live-missing-promoted-object")).toBeUndefined();
  });

  it("fails closed before creating approval when the stored live connection is missing required scopes", async () => {
    setMockEnv();
    const repository = new MemoryHermesRepository();
    await repository.saveAsset(request({}), {
      id: "asset-live-missing-required-scopes",
      tenantId,
      createdBy: requester.userId,
      assetType: "image",
      width: 1080,
      height: 1350,
      mimeType: "image/png",
      sourceUrl: "https://cdn.example.com/assets/live-missing-required-scopes.png",
      metadataJson: {}
    });
    mutableEnv.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 17).toString("base64");
    const encrypted = encryptToken("server-token", mutableEnv.TOKEN_ENCRYPTION_KEY, "primary");
    await repository.saveMetaConnection(request({}), {
      id: "meta-live-draft-missing-required-scopes",
      tenantId,
      createdBy: requester.userId,
      provider: "meta",
      connectionMode: "oauth",
      encryptedAccessToken: encrypted.encryptedAccessToken,
      tokenIv: encrypted.tokenIv,
      tokenAuthTag: encrypted.tokenAuthTag,
      tokenKid: encrypted.tokenKid,
      scopes: ["ads_read"],
      status: "connected",
      metadataJson: {
        mode: "live"
      }
    });

    const response = await createPausedDraft(
      request({
        draftId: "draft-live-missing-required-scopes",
        adAccountId: "act_live_123",
        assetId: "asset-live-missing-required-scopes",
        manifest,
        pageId: "page_1"
      })
    );
    const body = (await response.json()) as { error?: { code?: string; details?: { missingScopes?: string[] } } };
    const approvals = await repository.listApprovals(request({}), requester);

    expect(response.status).toBe(403);
    expect(body.error?.code).toBe("META_REQUIRED_SCOPES_MISSING");
    expect(body.error?.details?.missingScopes).toEqual(["ads_management", "business_management"]);
    expect(approvals.find((item) => item.objectId === "draft-live-missing-required-scopes")).toBeUndefined();
  });

  it("fails closed before creating approval when live Meta validate_only rejects the campaign payload", async () => {
    setMockEnv();
    const repository = new MemoryHermesRepository();
    await repository.saveAsset(request({}), {
      id: "asset-live-validate-only-failure",
      tenantId,
      createdBy: requester.userId,
      assetType: "image",
      width: 1080,
      height: 1350,
      mimeType: "image/png",
      sourceUrl: "https://cdn.example.com/assets/live-validate-only-failure.png",
      metadataJson: {}
    });
    mutableEnv.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 15).toString("base64");
    const encrypted = encryptToken("server-token", mutableEnv.TOKEN_ENCRYPTION_KEY, "primary");
    await repository.saveMetaConnection(request({}), {
      id: "meta-live-draft-validate-only-failure",
      tenantId,
      createdBy: requester.userId,
      provider: "meta",
      connectionMode: "oauth",
      encryptedAccessToken: encrypted.encryptedAccessToken,
      tokenIv: encrypted.tokenIv,
      tokenAuthTag: encrypted.tokenAuthTag,
      tokenKid: encrypted.tokenKid,
      scopes: ["ads_read", "ads_management", "business_management"],
      status: "connected",
      metadataJson: {
        mode: "live"
      }
    });

    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              message: "Campaign objective is invalid for this account",
              type: "OAuthException",
              code: 100,
              error_subcode: 1815758
            }
          }),
          { status: 400 }
        )
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await createPausedDraft(
      request({
        draftId: "draft-live-validate-only-failure",
        adAccountId: "act_live_123",
        assetId: "asset-live-validate-only-failure",
        manifest,
        pageId: "page_1",
        payload: {
          objective: "OUTCOME_SALES",
          optimizationGoal: "OFFSITE_CONVERSIONS",
          targeting: {
            geo_locations: {
              countries: ["KR"]
            }
          },
          promotedObject: {
            pixel_id: "pixel_123",
            custom_event_type: "PURCHASE"
          }
        }
      })
    );
    const body = (await response.json()) as {
      error?: {
        code?: string;
        details?: {
          status?: number;
          metaErrorCode?: number;
          metaErrorSubcode?: number;
          providerMessage?: string;
        };
      };
    };
    const approvals = await repository.listApprovals(request({}), requester);

    expect(response.status).toBe(400);
    expect(body.error?.code).toBe("META_GRAPH_REQUEST_FAILED");
    expect(body.error?.details).toMatchObject({
      status: 400,
      metaErrorCode: 100,
      metaErrorSubcode: 1815758,
      providerMessage: "Campaign objective is invalid for this account"
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(approvals.find((item) => item.objectId === "draft-live-validate-only-failure")).toBeUndefined();
  });

  it("executes the full live Meta paused-draft chain server-side when a stored connection and source URL exist", async () => {
    setMockEnv();
    const repository = new MemoryHermesRepository();
    const approval = approvedDraftApproval("draft-live-success");
    await repository.saveApproval(request({}), approval);
    await repository.saveAsset(request({}), {
      id: "asset-live-success",
      tenantId,
      createdBy: requester.userId,
      assetType: "image",
      width: 1080,
      height: 1350,
      mimeType: "image/png",
      sourceUrl: "https://cdn.example.com/assets/live-success.png",
      metadataJson: {}
    });
    mutableEnv.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 12).toString("base64");
    const encrypted = encryptToken("server-token", mutableEnv.TOKEN_ENCRYPTION_KEY, "primary");
    await repository.saveMetaConnection(request({}), {
      id: "meta-live-draft-success",
      tenantId,
      createdBy: requester.userId,
      provider: "meta",
      connectionMode: "oauth",
      encryptedAccessToken: encrypted.encryptedAccessToken,
      tokenIv: encrypted.tokenIv,
      tokenAuthTag: encrypted.tokenAuthTag,
      tokenKid: encrypted.tokenKid,
      scopes: ["ads_read", "ads_management", "business_management"],
      status: "connected",
      metadataJson: {
        mode: "live"
      }
    });

    const fetchMock = vi
      .fn(async () => Response.json({ images: { "live-success.png": { hash: "hash_live_123" } } }))
      .mockImplementationOnce(async () =>
        Response.json({
          images: {
            "live-success.png": {
              hash: "hash_live_123"
            }
          }
        })
      )
      .mockImplementationOnce(async () => Response.json({ id: "creative_live_123" }))
      .mockImplementationOnce(async () => Response.json({ success: true }))
      .mockImplementationOnce(async () => Response.json({ id: "cmp_live_123" }))
      .mockImplementationOnce(async () => Response.json({ success: true }))
      .mockImplementationOnce(async () => Response.json({ id: "adset_live_123" }))
      .mockImplementationOnce(async () => Response.json({ id: "ad_live_123" }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await createPausedDraft(
      request({
        draftId: "draft-live-success",
        approvalRequestId: approval.id,
        adAccountId: "act_live_123",
        assetId: "asset-live-success",
        manifest,
        pageId: "page_1",
        payload: {
          campaignName: "Live campaign",
          adsetName: "Live adset",
          adName: "Live ad",
          creativeName: "Live creative",
          objective: "OUTCOME_SALES",
          optimizationGoal: "OFFSITE_CONVERSIONS",
          targeting: {
            geo_locations: {
              countries: ["KR"]
            }
          },
          promotedObject: {
            pixel_id: "pixel_123",
            custom_event_type: "PURCHASE"
          },
          billingEvent: "IMPRESSIONS",
          bidStrategy: "LOWEST_COST_WITHOUT_CAP",
          headline: "Hook",
          description: "Description",
          message: "Primary text",
          callToActionType: "SHOP_NOW"
        }
      })
    );
    const body = (await response.json()) as {
      draft: {
        id: string;
        metaCampaignId?: string;
        metaAdsetId?: string;
        metaAdId?: string;
      };
      approval: {
        status: string;
        executionResultJson?: {
          adapterMode?: string;
          imageHash?: string;
          creativeId?: string;
          campaignId?: string;
          adsetId?: string;
          adId?: string;
        };
      };
    };

    expect(response.status).toBe(201);
    expect(body.draft).toMatchObject({
      id: "draft-live-success",
      metaCampaignId: "cmp_live_123",
      metaAdsetId: "adset_live_123",
      metaAdId: "ad_live_123"
    });
    expect(body.approval).toMatchObject({
      status: "executed",
      executionResultJson: {
        adapterMode: "live",
        imageHash: "hash_live_123",
        creativeId: "creative_live_123",
        campaignId: "cmp_live_123",
        adsetId: "adset_live_123",
        adId: "ad_live_123"
      }
    });

    const calls = fetchMock.mock.calls as unknown as Array<[URL, RequestInit]>;
    expect(calls).toHaveLength(7);
    for (const [url, init] of calls) {
      expect(url.toString()).toContain("https://graph.facebook.com/");
      expect(url.searchParams.has("access_token")).toBe(false);
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer server-token");
    }

    const firstForm = calls[0][1].body as URLSearchParams;
    const secondForm = calls[1][1].body as URLSearchParams;
    const thirdForm = calls[2][1].body as URLSearchParams;
    const fifthForm = calls[4][1].body as URLSearchParams;
    expect(firstForm.get("url")).toBe("https://cdn.example.com/assets/live-success.png");
    expect(secondForm.get("object_story_spec")).toContain("\"image_hash\":\"hash_live_123\"");
    expect(thirdForm.get("execution_options")).toBe("[\"validate_only\"]");
    expect(fifthForm.get("execution_options")).toBe("[\"validate_only\"]");
    expect(JSON.stringify(body)).not.toContain("server-token");
  });
});
