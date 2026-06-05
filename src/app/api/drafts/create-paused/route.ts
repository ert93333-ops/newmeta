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
import { assertLiveMetaAdSetInput } from "@/lib/meta/live-draft-validation";
import { resolveMetaAdapter } from "@/lib/meta/resolve-meta-adapter";
import { getRepository } from "@/lib/repositories/hermes-repository";
import type { CreativeAssetRecord } from "@/lib/repositories/hermes-repository";
import type { CreativeAssetMetadata } from "@/lib/types";

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
    if (draftType !== "ad") {
      return fail("DRAFT_TYPE_NOT_SUPPORTED", "Only ad-level PAUSED draft execution is currently supported.", 501, {
        draftType
      });
    }
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

    const readiness = await resolvePausedDraftReadiness({
      request,
      context,
      repository,
      body,
      payload
    });
    if (readiness instanceof Response) {
      return readiness;
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
          adAccountId: readiness.adAccountId,
          assetId: readiness.asset.id,
          metaStatus: "PAUSED",
          preflight,
          adapterMode: readiness.resolvedAdapter.mode,
          connectionSource: readiness.resolvedAdapter.source,
          connectionId: readiness.resolvedAdapter.connectionId,
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

    const executionInput = buildPausedDraftExecutionInput({
      draftId,
      adAccountId: readiness.adAccountId,
      manifest: readManifest(body.manifest),
      pageId: readOptionalString(body.pageId)!,
      instagramActorId: readOptionalString(body.instagramActorId),
      linkUrl: readOptionalString(body.linkUrl) ?? readManifest(body.manifest).linkUrl!,
      asset: readiness.asset,
      approval,
      payload,
      existingCampaignId: readOptionalString(body.metaCampaignId),
      existingAdsetId: readOptionalString(body.metaAdsetId),
      existingAdId: readOptionalString(body.metaAdId)
    });
    const execution = await executePausedDraftThroughAdapter(readiness.resolvedAdapter.adapter, executionInput);

    const draft = await repository.saveAdDraft(request, {
      id: draftId,
      tenantId: context.tenantId,
      createdBy: context.userId,
      adAccountId: readiness.adAccountId,
      assetId: readiness.asset.id,
      approvalRequestId: approval.id,
      metaCampaignId: execution.campaignId,
      metaAdsetId: execution.adsetId,
      metaAdId: execution.adId,
      draftType,
      metaStatus: "PAUSED",
      preflightJson: preflight,
      payloadJson: payload
    });
    const executed = markExecuted(approval, {
      operation: "meta_create_ad_paused",
      result: "paused_draft_created",
      draftId: draft.id,
      metaStatus: draft.metaStatus,
      adapterMode: readiness.resolvedAdapter.mode,
      connectionSource: readiness.resolvedAdapter.source,
      connectionId: readiness.resolvedAdapter.connectionId,
      imageHash: execution.imageHash,
      videoId: execution.videoId,
      creativeId: execution.creativeId,
      campaignId: execution.campaignId,
      adsetId: execution.adsetId,
      adId: execution.adId
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
        execution,
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

interface PausedDraftExecutionInput {
  draftId: string;
  adAccountId: string;
  manifest: DraftPreflightInput["manifest"];
  pageId: string;
  instagramActorId?: string;
  linkUrl: string;
  asset: CreativeAssetRecord;
  approval: ReturnType<typeof createApprovalRequest>;
  payload: unknown;
  existingCampaignId?: string;
  existingAdsetId?: string;
  existingAdId?: string;
}

interface PausedDraftExecutionResult {
  imageHash?: string;
  videoId?: string;
  creativeId: string;
  campaignId: string;
  adsetId: string;
  adId: string;
}

interface PausedDraftReadiness {
  adAccountId: string;
  asset: CreativeAssetRecord;
  resolvedAdapter: Awaited<ReturnType<typeof resolveMetaAdapter>>;
}

async function executePausedDraftThroughAdapter(
  adapter: Awaited<ReturnType<typeof resolveMetaAdapter>>["adapter"],
  input: PausedDraftExecutionInput
): Promise<PausedDraftExecutionResult> {
    const uploadResult =
      input.asset.assetType === "video"
      ? await adapter.uploadVideo({
          adAccountId: input.adAccountId,
          asset: toCreativeAssetMetadata(input.asset),
          sourceUrl: input.asset.sourceUrl,
          storagePath: input.asset.storagePath,
          approval: input.approval
        })
      : await adapter.uploadImage({
          adAccountId: input.adAccountId,
          asset: toCreativeAssetMetadata(input.asset),
          sourceUrl: input.asset.sourceUrl,
          storagePath: input.asset.storagePath,
          approval: input.approval
        });

  const creative = await adapter.createCreative({
    adAccountId: input.adAccountId,
    name: readPayloadString(input.payload, "creativeName") ?? `Hermes creative ${input.draftId}`,
    pageId: input.pageId,
    instagramActorId: input.instagramActorId,
    linkUrl: input.linkUrl,
    imageHash: "imageHash" in uploadResult ? uploadResult.imageHash : undefined,
    imageUrl: input.asset.assetType === "image" ? input.asset.sourceUrl : undefined,
    videoId: "videoId" in uploadResult ? uploadResult.videoId : undefined,
    thumbnailUrl: readPayloadString(input.payload, "thumbnailUrl"),
    message: readPayloadString(input.payload, "message"),
    headline: readPayloadString(input.payload, "headline"),
    description: readPayloadString(input.payload, "description"),
    callToActionType: readPayloadString(input.payload, "callToActionType"),
    approval: input.approval
  });

  const campaignId =
    input.existingCampaignId ??
    (
      await adapter.createCampaignPaused({
        adAccountId: input.adAccountId,
        name: readPayloadString(input.payload, "campaignName") ?? `Hermes campaign ${input.draftId}`,
        objective: readPayloadString(input.payload, "objective") ?? "OUTCOME_SALES",
        buyingType: readPayloadString(input.payload, "buyingType"),
        specialAdCategories: readPayloadStringArray(input.payload, "specialAdCategories"),
        approval: input.approval
      })
    ).campaignId;

  const adsetId =
    input.existingAdsetId ??
    (
      await adapter.createAdSetPaused({
        adAccountId: input.adAccountId,
        campaignId,
        name: readPayloadString(input.payload, "adsetName") ?? `Hermes adset ${input.draftId}`,
        objective: readPayloadString(input.payload, "objective") ?? "OUTCOME_SALES",
        optimizationGoal: readPayloadString(input.payload, "optimizationGoal") ?? "OFFSITE_CONVERSIONS",
        targeting: readPayloadRecord(input.payload, "targeting") ?? {},
        billingEvent: readPayloadString(input.payload, "billingEvent"),
        bidStrategy: readPayloadString(input.payload, "bidStrategy"),
        promotedObject: readPayloadRecord(input.payload, "promotedObject"),
        attributionSpec: readPayloadArray(input.payload, "attributionSpec"),
        destinationType: readPayloadString(input.payload, "destinationType"),
        startTime: readPayloadString(input.payload, "startTime"),
        endTime: readPayloadString(input.payload, "endTime"),
        approval: input.approval
      })
    ).adsetId;

  const adId =
    input.existingAdId ??
    (
      await adapter.createAdPaused({
        adAccountId: input.adAccountId,
        adsetId,
        name: readPayloadString(input.payload, "adName") ?? `Hermes ad ${input.draftId}`,
        creativeId: creative.creativeId,
        trackingSpecs: readPayloadArray(input.payload, "trackingSpecs"),
        urlTags: readPayloadString(input.payload, "urlTags"),
        approval: input.approval
      })
    ).adId;

  return {
    imageHash: "imageHash" in uploadResult ? uploadResult.imageHash : undefined,
    videoId: "videoId" in uploadResult ? uploadResult.videoId : undefined,
    creativeId: creative.creativeId,
    campaignId,
    adsetId,
    adId
  };
}

function buildPausedDraftExecutionInput(input: {
  draftId: string;
  adAccountId: string;
  manifest: DraftPreflightInput["manifest"];
  pageId: string;
  instagramActorId?: string;
  linkUrl: string;
  asset: CreativeAssetRecord;
  approval: ReturnType<typeof createApprovalRequest>;
  payload: unknown;
  existingCampaignId?: string;
  existingAdsetId?: string;
  existingAdId?: string;
}): PausedDraftExecutionInput {
  return input;
}

async function resolvePausedDraftReadiness(input: {
  request: Request;
  context: Awaited<ReturnType<typeof resolveUserContext>>;
  repository: ReturnType<typeof getRepository>;
  body: CreatePausedDraftRequest;
  payload: unknown;
}): Promise<PausedDraftReadiness | Response> {
  const assetId = readOptionalString(input.body.assetId) ?? readOptionalString(input.body.manifest?.asset?.id);
  if (!assetId) {
    return fail("CREATIVE_ASSET_ID_REQUIRED", "Draft creation requires a persisted asset id.", 400);
  }

  const asset = await input.repository.getAsset(input.request, input.context, assetId);
  if (!asset) {
    return fail("CREATIVE_ASSET_NOT_FOUND", "Draft creation requires a same-tenant persisted asset.", 404, {
      assetId
    });
  }

  const adAccountId = readOptionalString(input.body.adAccountId);
  if (!adAccountId) {
    return fail("META_AD_ACCOUNT_REQUIRED", "Draft creation requires a Meta ad account id.", 400);
  }

  const resolvedAdapter = await resolveMetaAdapter({
    request: input.request,
    context: input.context,
    repository: input.repository
  });

  if (resolvedAdapter.mode === "live" && !asset.sourceUrl) {
    return fail(
      "META_ASSET_SOURCE_URL_REQUIRED",
      "Live Meta draft execution requires a persisted public source URL for the creative asset.",
      422,
      {
        assetId: asset.id
      }
    );
  }

  if (resolvedAdapter.mode === "live" && asset.assetType === "video" && !readPayloadString(input.payload, "thumbnailUrl")) {
    return fail(
      "META_VIDEO_THUMBNAIL_REQUIRED",
      "Live Meta video draft execution requires a thumbnailUrl for the creative preview.",
      422,
      {
        assetId: asset.id
      }
    );
  }

  if (resolvedAdapter.mode === "live") {
    assertLiveMetaAdSetInput({
      objective: readPayloadString(input.payload, "objective") ?? "OUTCOME_SALES",
      optimizationGoal: readPayloadString(input.payload, "optimizationGoal") ?? "OFFSITE_CONVERSIONS",
      targeting: readPayloadRecord(input.payload, "targeting") ?? {},
      promotedObject: readPayloadRecord(input.payload, "promotedObject")
    });
  }

  return {
    adAccountId,
    asset,
    resolvedAdapter
  };
}

function toCreativeAssetMetadata(asset: CreativeAssetRecord): CreativeAssetMetadata {
  return {
    id: asset.id,
    type: asset.assetType,
    width: asset.width,
    height: asset.height,
    durationSeconds: asset.durationSeconds,
    mimeType: asset.mimeType,
    fileSizeBytes: readAssetFileSizeBytes(asset)
  };
}

function readAssetFileSizeBytes(asset: CreativeAssetRecord): number | undefined {
  if (typeof asset.metadataJson !== "object" || asset.metadataJson === null || !("fileSizeBytes" in asset.metadataJson)) {
    return undefined;
  }
  const value = (asset.metadataJson as Record<string, unknown>).fileSizeBytes;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function readPayloadString(payload: unknown, key: string): string | undefined {
  if (typeof payload !== "object" || payload === null || !(key in payload)) {
    return undefined;
  }
  return readOptionalString((payload as Record<string, unknown>)[key]);
}

function readPayloadRecord(payload: unknown, key: string): Record<string, unknown> | undefined {
  if (typeof payload !== "object" || payload === null || !(key in payload)) {
    return undefined;
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readPayloadArray(payload: unknown, key: string): unknown[] | undefined {
  if (typeof payload !== "object" || payload === null || !(key in payload)) {
    return undefined;
  }
  const value = (payload as Record<string, unknown>)[key];
  return Array.isArray(value) ? value : undefined;
}

function readPayloadStringArray(payload: unknown, key: string): string[] | undefined {
  const value = readPayloadArray(payload, key);
  if (!value) {
    return undefined;
  }
  const strings = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return strings.length > 0 ? strings : undefined;
}
