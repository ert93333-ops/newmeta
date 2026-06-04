import { randomUUID } from "node:crypto";
import { checkForbiddenFinalText, checkPriceAccuracy, checkSafeArea } from "@/lib/creative/checkers";
import { handleError, ok, parseWriteJson } from "@/lib/api/responses";
import { resolveUserContext } from "@/lib/api/context";
import { getRepository } from "@/lib/repositories/hermes-repository";
import type { CreativeManifest } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const context = await resolveUserContext(request);
    const manifest = (await parseWriteJson(request)) as CreativeManifest;
    const checks = {
      safeArea: checkSafeArea(manifest),
      priceAccuracy: checkPriceAccuracy(manifest),
      forbiddenFinalText: checkForbiddenFinalText(manifest.textBoxes)
    };
    const job = {
      id: randomUUID(),
      tenantId: context.tenantId,
      createdBy: context.userId,
      type: "render",
      status: Object.values(checks).every((check) => check.passed) ? "succeeded" : "failed",
      result: {
        finalImage: "ready_without_guides",
        qaImage: "ready_with_safezone_overlay",
        checks
      }
    };
    await getRepository().saveJob(request, job);
    return ok(job, 201);
  } catch (error) {
    return handleError(error);
  }
}
