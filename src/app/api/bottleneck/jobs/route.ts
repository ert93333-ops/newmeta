import { randomUUID } from "node:crypto";
import { diagnoseBottlenecks } from "@/lib/bottleneck/diagnosis";
import { handleError, ok, parseWriteJson } from "@/lib/api/responses";
import { resolveUserContext } from "@/lib/api/context";
import { getRepository } from "@/lib/repositories/hermes-repository";
import type { MetaInsight } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const context = await resolveUserContext(request);
    const insight = (await parseWriteJson(request)) as MetaInsight;
    const job = {
      id: randomUUID(),
      tenantId: context.tenantId,
      createdBy: context.userId,
      type: "bottleneck_diagnosis",
      status: "succeeded",
      result: diagnoseBottlenecks(insight)
    };
    await getRepository().saveJob(request, job);
    return ok(job, 201);
  } catch (error) {
    return handleError(error);
  }
}
