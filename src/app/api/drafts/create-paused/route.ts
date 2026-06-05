import { randomUUID } from "node:crypto";
import {
  approvalGuardDetails,
  assertExecutableApproval,
  createApprovalRequest,
  markExecuted
} from "@/lib/approval/approval-policy";
import { handleError, ok, parseWriteJson, fail } from "@/lib/api/responses";
import { resolveUserContext } from "@/lib/api/context";
import { runDraftPreflight, type DraftPreflightInput } from "@/lib/drafts/preflight";
import { getRepository } from "@/lib/repositories/hermes-repository";

interface CreatePausedDraftRequest extends Partial<DraftPreflightInput> {
  approvalRequestId?: unknown;
  draftId?: unknown;
  draftType?: unknown;
  adAccountId?: unknown;
  assetId?: unknown;
  metaCampaignId?: unknown;
  metaAdsetId?: unknown;
  metaAdId?: unknown;
  payload?: unknown;
  reason?: unknown;
}

export async function POST(request: Request) {
  try {
    const context = await resolveUserContext(request);
    const repository = getRepository();
    const body = (await parseWriteJson(request)) as CreatePausedDraftRequest;
    const draftId = readOptionalString(body.draftId) ?? randomUUID();
    const draftType = readOptionalString(body.draftType) ?? "ad";
    const payload = body.payload ?? body;
    const preflight = runDraftPreflight({
      manifest: readManifest(body.manifest),
      pageId: readOptionalString(body.pageId),
      instagramActorId: readOptionalString(body.instagramActorId),
      linkUrl: readOptionalString(body.linkUrl),
      cost: body.cost,
      actionPayload: payload
    });

    if (preflight.status === "blocked") {
      return fail("DRAFT_PREFLIGHT_BLOCKED", "Draft preflight blocked this request.", 422, preflight);
    }

    const approvalRequestId = readOptionalString(body.approvalRequestId);
    if (!approvalRequestId) {
      const approval = createApprovalRequest({
        context,
        action: "meta_create_ad_paused",
        objectType: "ad_draft",
        objectId: draftId,
        beforeJson: {
          status: "not_created"
        },
        afterJson: {
          draftId,
          draftType,
          adAccountId: readOptionalString(body.adAccountId),
          assetId: readOptionalString(body.assetId),
          metaStatus: "PAUSED",
          preflight,
          payload
        },
        reason: readOptionalString(body.reason) ?? "Create PAUSED Meta draft after preflight."
      });
      await repository.saveApproval(request, approval);
      await repository.saveAuditLog(request, {
        tenantId: context.tenantId,
        userId: context.userId,
        action: "approval_requested:meta_create_ad_paused",
        objectType: "ad_draft",
        objectId: draftId,
        approvalRequestId: approval.id,
        afterJson: approval,
        result: "approval_required"
      });

      return ok(
        {
          status: "approval_required",
          draftId,
          preflight,
          approval,
          guard: approvalGuardDetails(approval)
        },
        202
      );
    }

    const approval = await repository.getApproval(request, context, approvalRequestId);
    if (!approval || approval.action !== "meta_create_ad_paused") {
      throw new Error("APPROVAL_REQUIRED");
    }
    if (approval.objectId && approval.objectId !== draftId) {
      throw new Error("APPROVAL_REQUIRED");
    }
    assertExecutableApproval(approval, context);

    const draft = await repository.saveAdDraft(request, {
      id: draftId,
      tenantId: context.tenantId,
      createdBy: context.userId,
      adAccountId: readOptionalString(body.adAccountId),
      assetId: readOptionalString(body.assetId),
      approvalRequestId: approval.id,
      metaCampaignId: readOptionalString(body.metaCampaignId),
      metaAdsetId: readOptionalString(body.metaAdsetId),
      metaAdId: readOptionalString(body.metaAdId),
      draftType,
      metaStatus: "PAUSED",
      preflightJson: preflight,
      payloadJson: payload
    });
    const executed = markExecuted(approval, {
      operation: "meta_create_ad_paused",
      result: "paused_draft_created",
      draftId: draft.id,
      metaStatus: draft.metaStatus
    });
    const persistedApproval = await repository.updateApproval(request, executed);

    await repository.saveAuditLog(request, {
      tenantId: context.tenantId,
      userId: context.userId,
      action: "draft_created:meta_create_ad_paused",
      objectType: "ad_draft",
      objectId: draft.id,
      approvalRequestId: persistedApproval.id,
      beforeJson: approval,
      afterJson: {
        approval: persistedApproval,
        draft
      },
      result: "paused_draft_created"
    });

    return ok({ draft, approval: persistedApproval, preflight }, 201);
  } catch (error) {
    return handleError(error);
  }
}

function readManifest(value: unknown): DraftPreflightInput["manifest"] {
  if (typeof value !== "object" || value === null || !("asset" in value) || !("textBoxes" in value)) {
    throw new Error("DRAFT_MANIFEST_REQUIRED");
  }
  return value as DraftPreflightInput["manifest"];
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}
