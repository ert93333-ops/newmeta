import { randomUUID } from "node:crypto";
import { checkForbiddenFinalText, checkPriceAccuracy, checkSafeArea } from "@/lib/creative/checkers";
import { handleError, ok, parseJson } from "@/lib/api/responses";
import { getStore, mockContext } from "@/lib/api/store";
import type { CreativeManifest } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const manifest = (await parseJson(request)) as CreativeManifest;
    const checks = {
      safeArea: checkSafeArea(manifest),
      priceAccuracy: checkPriceAccuracy(manifest),
      forbiddenFinalText: checkForbiddenFinalText(manifest.textBoxes)
    };
    const job = {
      id: randomUUID(),
      tenantId: mockContext().tenantId,
      type: "render",
      status: Object.values(checks).every((check) => check.passed) ? "succeeded" : "failed",
      result: {
        finalImage: "ready_without_guides",
        qaImage: "ready_with_safezone_overlay",
        checks
      }
    };
    getStore().jobs.set(job.id, job);
    return ok(job, 201);
  } catch (error) {
    return handleError(error);
  }
}
