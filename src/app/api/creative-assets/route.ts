import { randomUUID } from "node:crypto";
import { fail, handleError, ok, parseWriteJson } from "@/lib/api/responses";
import { resolveUserContext } from "@/lib/api/context";
import { getRepository } from "@/lib/repositories/hermes-repository";
import type { CreativeAssetRecord } from "@/lib/repositories/hermes-repository";
import type { CreativeAssetMetadata, CreativeAssetType } from "@/lib/types";

interface CreateCreativeAssetRequest {
  asset: CreativeAssetMetadata;
  sourceUrl?: string;
  storagePath?: string;
  checksumSha256?: string;
  originalFilename?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export async function POST(request: Request) {
  try {
    const context = await resolveUserContext(request);
    const body = (await parseWriteJson(request)) as unknown;
    const parsed = parseCreateAssetRequest(body);

    if (!parsed.ok) {
      return fail(parsed.code, parsed.message, 400, parsed.details);
    }

    const repository = getRepository();
    const asset = await repository.saveAsset(request, {
      id: randomUUID(),
      tenantId: context.tenantId,
      createdBy: context.userId,
      assetType: parsed.value.asset.type,
      storagePath: parsed.value.storagePath,
      sourceUrl: parsed.value.sourceUrl,
      sha256: parsed.value.checksumSha256,
      width: parsed.value.asset.width,
      height: parsed.value.asset.height,
      durationSeconds: parsed.value.asset.durationSeconds,
      mimeType: parsed.value.asset.mimeType,
      metadataJson: {
        fileSizeBytes: parsed.value.asset.fileSizeBytes,
        originalFilename: parsed.value.originalFilename,
        tags: parsed.value.tags,
        ...(parsed.value.metadata ?? {})
      }
    });

    await repository.saveAuditLog(request, {
      tenantId: context.tenantId,
      userId: context.userId,
      action: "creative_asset_created",
      objectType: "creative_asset",
      objectId: asset.id,
      afterJson: auditPayload(asset),
      result: "created"
    });

    return ok({ asset }, 201);
  } catch (error) {
    return handleError(error);
  }
}

function parseCreateAssetRequest(body: unknown):
  | { ok: true; value: CreateCreativeAssetRequest }
  | { ok: false; code: string; message: string; details?: unknown } {
  if (!isRecord(body)) {
    return invalid("Creative asset payload must be an object.");
  }

  const assetValue = body.asset;
  if (!isRecord(assetValue)) {
    return invalid("Creative asset payload requires an asset object.", { field: "asset" });
  }

  const type = parseAssetType(assetValue.type);
  if (!type) {
    return invalid("Creative asset type must be image or video.", { field: "asset.type" });
  }

  const width = parsePositiveInteger(assetValue.width);
  const height = parsePositiveInteger(assetValue.height);
  if (!width || !height) {
    return invalid("Creative asset width and height must be positive integers.", {
      fields: ["asset.width", "asset.height"]
    });
  }

  const durationSeconds = assetValue.durationSeconds === undefined ? undefined : parsePositiveNumber(assetValue.durationSeconds);
  if (assetValue.durationSeconds !== undefined && durationSeconds === undefined) {
    return invalid("Creative asset duration must be a positive number when provided.", {
      field: "asset.durationSeconds"
    });
  }
  if (type === "image" && durationSeconds !== undefined) {
    return invalid("Image assets must not include durationSeconds.", { field: "asset.durationSeconds" });
  }
  if (type === "video" && durationSeconds === undefined) {
    return invalid("Video assets require durationSeconds.", { field: "asset.durationSeconds" });
  }

  const mimeType = parseOptionalString(assetValue.mimeType);
  if (mimeType && !mimeTypeMatchesType(type, mimeType)) {
    return invalid("Creative asset mimeType does not match the declared asset type.", {
      field: "asset.mimeType",
      assetType: type
    });
  }

  const fileSizeBytes = assetValue.fileSizeBytes === undefined ? undefined : parsePositiveInteger(assetValue.fileSizeBytes);
  if (assetValue.fileSizeBytes !== undefined && fileSizeBytes === undefined) {
    return invalid("Creative asset fileSizeBytes must be a positive integer when provided.", {
      field: "asset.fileSizeBytes"
    });
  }

  const tags = parseOptionalStringArray(body.tags);
  if (body.tags !== undefined && !tags) {
    return invalid("Creative asset tags must be a string array when provided.", { field: "tags" });
  }

  const metadata = body.metadata;
  if (metadata !== undefined && !isRecord(metadata)) {
    return invalid("Creative asset metadata must be an object when provided.", { field: "metadata" });
  }

  return {
    ok: true,
    value: {
      asset: {
        type,
        width,
        height,
        durationSeconds,
        mimeType,
        fileSizeBytes
      },
      sourceUrl: parseOptionalString(body.sourceUrl),
      storagePath: parseOptionalString(body.storagePath),
      checksumSha256: parseOptionalString(body.checksumSha256),
      originalFilename: parseOptionalString(body.originalFilename),
      tags,
      metadata
    }
  };
}

function auditPayload(asset: CreativeAssetRecord): Record<string, unknown> {
  return {
    id: asset.id,
    assetType: asset.assetType,
    storagePath: asset.storagePath,
    sourceUrl: asset.sourceUrl,
    sha256: asset.sha256,
    width: asset.width,
    height: asset.height,
    durationSeconds: asset.durationSeconds,
    mimeType: asset.mimeType,
    metadataJson: asset.metadataJson
  };
}

function invalid(message: string, details?: unknown) {
  return {
    ok: false as const,
    code: "CREATIVE_ASSET_PAYLOAD_INVALID",
    message,
    details
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAssetType(value: unknown): CreativeAssetType | undefined {
  return value === "image" || value === "video" ? value : undefined;
}

function parsePositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return undefined;
  }
  return value;
}

function parsePositiveNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
}

function parseOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const strings = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return strings.length === value.length ? strings : undefined;
}

function mimeTypeMatchesType(type: CreativeAssetType, mimeType: string): boolean {
  return mimeType.startsWith(`${type}/`);
}
