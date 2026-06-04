import { randomUUID } from "node:crypto";
import { analyzeImageCreative } from "@/lib/creative/image-analysis";
import { analyzeVideoCreative } from "@/lib/creative/video-analysis";
import { handleError, ok, parseWriteJson } from "@/lib/api/responses";
import { resolveUserContext } from "@/lib/api/context";
import { getRepository } from "@/lib/repositories/hermes-repository";
import type { CreativeManifest } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const context = await resolveUserContext(request);
    const manifest = (await parseWriteJson(request)) as CreativeManifest;
    const result = manifest.asset.type === "video" ? analyzeVideoCreative(manifest.asset) : analyzeImageCreative(manifest);
    const job = {
      id: randomUUID(),
      tenantId: context.tenantId,
      createdBy: context.userId,
      type: "creative_analysis",
      status: "succeeded",
      result
    };
    await getRepository().saveJob(request, job);
    return ok(job, 201);
  } catch (error) {
    return handleError(error);
  }
}
