import { createHash, randomUUID } from "node:crypto";

export interface GeneratedAssetCandidate {
  id: string;
  assetType: "image" | "video";
  sourceUrl?: string;
  storagePath?: string;
  width: number;
  height: number;
  durationSeconds?: number;
  mimeType?: string;
  sha256?: string;
  metadataJson: Record<string, unknown>;
}

export function extractGeneratedAssetCandidates(input: {
  result: Record<string, unknown>;
  jobType: string;
  jobId: string;
  approvalRequestId?: string;
  generationContext?: unknown;
}): GeneratedAssetCandidate[] {
  const providerResult = readRecord(input.result.providerResult) ?? readRecord(input.result) ?? {};
  const urls = [
    ...readUrlFields(providerResult),
    ...readUrlFields(readRecord(providerResult.providerResult)),
    ...readOpenAiDataUrls(providerResult)
  ];
  const uniqueUrls = Array.from(new Set(urls)).slice(0, 20);
  return uniqueUrls.map((sourceUrl, index) => {
    const assetType = input.jobType === "video_generation" || looksLikeVideoUrl(sourceUrl) ? "video" : "image";
    const dimensions = defaultDimensions(assetType);
    return {
      id: randomUUID(),
      assetType,
      sourceUrl,
      width: dimensions.width,
      height: dimensions.height,
      durationSeconds: assetType === "video" ? undefined : undefined,
      mimeType: assetType === "video" ? readMimeType(sourceUrl, "video/mp4") : readMimeType(sourceUrl, "image/png"),
      sha256: stableCandidateHash(input.jobId, sourceUrl, index),
      metadataJson: {
        source: "paid_generation_worker",
        jobId: input.jobId,
        approvalRequestId: input.approvalRequestId,
        variantName: variantName(index),
        registrationMode: "paused_draft_after_qa",
        draftRoute: "/api/drafts/create-paused",
        experimentGroup: {
          mode: "controlled_ab_test",
          candidateIndex: index,
          controlRequired: true
        },
        generationContext: input.generationContext
      }
    };
  });
}

function readUrlFields(value: unknown): string[] {
  const record = readRecord(value);
  if (!record) {
    return [];
  }
  const directKeys = ["assetUrl", "imageUrl", "videoUrl", "url", "sourceUrl"];
  const directUrls = directKeys.flatMap((key) => readHttpUrl(record[key]) ?? []);
  const arrayUrls = ["assets", "images", "videos", "outputs", "generatedAssets"].flatMap((key) => readUrlArray(record[key]));
  return [...directUrls, ...arrayUrls];
}

function readUrlArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const direct = readHttpUrl(item);
    if (direct) {
      return [direct];
    }
    return readUrlFields(item);
  });
}

function readOpenAiDataUrls(providerResult: Record<string, unknown>): string[] {
  const data = Array.isArray(providerResult.data) ? providerResult.data : [];
  return data.flatMap((item) => {
    const record = readRecord(item);
    return readHttpUrl(record?.url) ?? [];
  });
}

function readHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function looksLikeVideoUrl(value: string): boolean {
  return /\.(mp4|mov|webm)(\?|#|$)/i.test(value);
}

function defaultDimensions(assetType: "image" | "video"): { width: number; height: number } {
  return assetType === "video" ? { width: 1080, height: 1920 } : { width: 1080, height: 1350 };
}

function readMimeType(sourceUrl: string, fallback: string): string {
  if (/\.(jpe?g)(\?|#|$)/i.test(sourceUrl)) return "image/jpeg";
  if (/\.(webp)(\?|#|$)/i.test(sourceUrl)) return "image/webp";
  if (/\.(mp4)(\?|#|$)/i.test(sourceUrl)) return "video/mp4";
  if (/\.(webm)(\?|#|$)/i.test(sourceUrl)) return "video/webm";
  return fallback;
}

function stableCandidateHash(jobId: string, sourceUrl: string, index: number): string {
  return createHash("sha256").update(`${jobId}:${index}:${sourceUrl}`).digest("hex");
}

function variantName(index: number): string {
  return String.fromCharCode("A".charCodeAt(0) + index);
}
