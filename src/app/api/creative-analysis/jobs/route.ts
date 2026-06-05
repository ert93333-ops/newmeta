import { randomUUID } from "node:crypto";
import { analyzeImageCreative } from "@/lib/creative/image-analysis";
import { analyzeVideoCreative } from "@/lib/creative/video-analysis";
import { fail, handleError, ok, parseWriteJson } from "@/lib/api/responses";
import { resolveUserContext } from "@/lib/api/context";
import { getRepository } from "@/lib/repositories/hermes-repository";
import type { CreativeAssetRecord, CreativeFeatureRecord } from "@/lib/repositories/hermes-repository";
import type { CreativeAssetMetadata, CreativeManifest } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const context = await resolveUserContext(request);
    const repository = getRepository();
    const manifest = (await parseWriteJson(request)) as CreativeManifest;
    const assetId = readAssetId(manifest);
    if (!assetId) {
      return fail("CREATIVE_ASSET_ID_REQUIRED", "Creative analysis requires a persisted asset id.", 400);
    }
    const persistedAsset = await repository.getAsset(request, context, assetId);
    if (!persistedAsset) {
      return fail("CREATIVE_ASSET_NOT_FOUND", "Creative analysis requires a same-tenant persisted asset.", 404, {
        assetId
      });
    }
    const normalizedManifest = normalizeManifest(manifest, persistedAsset);
    const result =
      normalizedManifest.asset.type === "video"
        ? analyzeVideoCreative(normalizedManifest.asset)
        : analyzeImageCreative(normalizedManifest);
    const jobId = randomUUID();
    await repository.saveCreativeAnalysisJob(request, {
      id: jobId,
      tenantId: context.tenantId,
      createdBy: context.userId,
      assetId,
      status: "succeeded",
      analysisType: normalizedManifest.asset.type,
      resultJson: result
    });
    await repository.saveCreativeFeatures(request, buildFeatureRows(jobId, assetId, context.tenantId, context.userId, result));
    await repository.saveCreativeComponentScores(
      request,
      result.scores.map((score) => ({
        id: randomUUID(),
        tenantId: context.tenantId,
        createdBy: context.userId,
        assetId,
        scoreName: score.name,
        scoreValue: score.value,
        evidenceJson: score.evidence
      }))
    );
    if ("segments" in result) {
      await repository.saveVideoSegments(
        request,
        result.segments.map((segment) => {
          const [startSeconds, endSeconds] = segmentBounds(segment.range, normalizedManifest.asset.durationSeconds);
          return {
            id: randomUUID(),
            tenantId: context.tenantId,
            createdBy: context.userId,
            assetId,
            startSeconds,
            endSeconds,
            segmentJson: segment
          };
        })
      );
    }
    const job = {
      id: jobId,
      tenantId: context.tenantId,
      createdBy: context.userId,
      type: "creative_analysis",
      status: "succeeded",
      result
    };
    await repository.saveJob(request, job);
    await repository.saveAuditLog(request, {
      tenantId: context.tenantId,
      userId: context.userId,
      action: "creative_analysis_created",
      objectType: "creative_analysis_job",
      objectId: jobId,
      afterJson: {
        job,
        assetId,
        analysisType: normalizedManifest.asset.type,
        scoreCount: result.scores.length
      },
      result: "created"
    });
    return ok(job, 201);
  } catch (error) {
    return handleError(error);
  }
}

function readAssetId(manifest: CreativeManifest): string | undefined {
  if (!manifest || typeof manifest !== "object" || !("asset" in manifest)) {
    return undefined;
  }
  if (!manifest.asset || typeof manifest.asset.id !== "string") {
    return undefined;
  }
  const trimmed = manifest.asset.id.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeManifest(manifest: CreativeManifest, persistedAsset: CreativeAssetRecord): CreativeManifest {
  return {
    ...manifest,
    asset: {
      id: persistedAsset.id,
      type: persistedAsset.assetType,
      width: persistedAsset.width,
      height: persistedAsset.height,
      durationSeconds: persistedAsset.durationSeconds,
      mimeType: persistedAsset.mimeType,
      fileSizeBytes: readPersistedFileSizeBytes(persistedAsset)
    } satisfies CreativeAssetMetadata
  };
}

function readPersistedFileSizeBytes(asset: CreativeAssetRecord): number | undefined {
  if (typeof asset.metadataJson !== "object" || asset.metadataJson === null || !("fileSizeBytes" in asset.metadataJson)) {
    return undefined;
  }
  const value = (asset.metadataJson as Record<string, unknown>).fileSizeBytes;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function buildFeatureRows(
  jobId: string,
  assetId: string,
  tenantId: string,
  userId: string,
  result: ReturnType<typeof analyzeImageCreative> | ReturnType<typeof analyzeVideoCreative>
): CreativeFeatureRecord[] {
  if ("checks" in result) {
    const features: CreativeFeatureRecord[] = [
      {
        id: randomUUID(),
        tenantId,
        createdBy: userId,
        assetId,
        featureType: "checks",
        featureJson: result.checks
      },
      {
        id: randomUUID(),
        tenantId,
        createdBy: userId,
        assetId,
        featureType: "recommendations",
        featureJson: {
          items: result.recommendations,
          creativeAnalysisJobId: jobId
        }
      }
    ];
    if (result.placement) {
      features.push({
        id: randomUUID(),
        tenantId,
        createdBy: userId,
        assetId,
        featureType: "placement",
        featureJson: result.placement
      });
    }
    return features;
  }

  return [
    {
      id: randomUUID(),
      tenantId,
      createdBy: userId,
      assetId,
      featureType: "metadata",
      featureJson: result.metadata
    },
    {
      id: randomUUID(),
      tenantId,
      createdBy: userId,
      assetId,
      featureType: "silent_viewing_ready",
      featureJson: {
        value: result.silentViewingReady,
        creativeAnalysisJobId: jobId
      }
    }
  ];
}

function segmentBounds(range: string, durationSeconds?: number): [number, number] {
  const matches = range.match(/\d+(?:\.\d+)?/g) ?? [];
  if (matches.length >= 2) {
    return [Number(matches[0]), Number(matches[1])];
  }
  if (matches.length === 1) {
    const start = Number(matches[0]);
    const end = typeof durationSeconds === "number" && durationSeconds > start ? durationSeconds : start;
    return [start, end];
  }
  return [0, 0];
}
