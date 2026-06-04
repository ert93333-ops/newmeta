import { randomUUID } from "node:crypto";
import { MockMetaAdapter } from "@/lib/meta/mock-meta-adapter";
import { handleError, ok, parseWriteJson } from "@/lib/api/responses";
import { resolveUserContext } from "@/lib/api/context";
import { getRepository } from "@/lib/repositories/hermes-repository";

export async function POST(request: Request) {
  try {
    const context = await resolveUserContext(request);
    const body = (await parseWriteJson(request)) as { adAccountId?: string };
    const adapter = new MockMetaAdapter();
    const insights = await adapter.getInsights({ adAccountId: body.adAccountId ?? "act_mock_001" });
    const job = {
      id: randomUUID(),
      tenantId: context.tenantId,
      createdBy: context.userId,
      status: "succeeded",
      type: "meta_insights_sync",
      result: insights
    };
    await getRepository().saveJob(request, job);
    return ok(job, 201);
  } catch (error) {
    return handleError(error);
  }
}
