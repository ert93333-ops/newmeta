import { randomUUID } from "node:crypto";
import { analyzeImageCreative } from "@/lib/creative/image-analysis";
import { analyzeVideoCreative } from "@/lib/creative/video-analysis";
import { handleError, ok, parseJson } from "@/lib/api/responses";
import { getStore, mockContext } from "@/lib/api/store";
import type { CreativeManifest } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const manifest = (await parseJson(request)) as CreativeManifest;
    const result = manifest.asset.type === "video" ? analyzeVideoCreative(manifest.asset) : analyzeImageCreative(manifest);
    const job = {
      id: randomUUID(),
      tenantId: mockContext().tenantId,
      type: "creative_analysis",
      status: "succeeded",
      result
    };
    getStore().jobs.set(job.id, job);
    return ok(job, 201);
  } catch (error) {
    return handleError(error);
  }
}
