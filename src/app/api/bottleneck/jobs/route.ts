import { randomUUID } from "node:crypto";
import { diagnoseBottlenecks } from "@/lib/bottleneck/diagnosis";
import { handleError, ok, parseJson } from "@/lib/api/responses";
import { getStore, mockContext } from "@/lib/api/store";
import type { MetaInsight } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const insight = (await parseJson(request)) as MetaInsight;
    const job = {
      id: randomUUID(),
      tenantId: mockContext().tenantId,
      type: "bottleneck_diagnosis",
      status: "succeeded",
      result: diagnoseBottlenecks(insight)
    };
    getStore().jobs.set(job.id, job);
    return ok(job, 201);
  } catch (error) {
    return handleError(error);
  }
}
