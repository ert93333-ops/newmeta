import { randomUUID } from "node:crypto";
import { MockMetaAdapter } from "@/lib/meta/mock-meta-adapter";
import { handleError, ok, parseJson } from "@/lib/api/responses";
import { getStore, mockContext } from "@/lib/api/store";

export async function POST(request: Request) {
  try {
    const body = (await parseJson(request)) as { adAccountId?: string };
    const adapter = new MockMetaAdapter();
    const insights = await adapter.getInsights({ adAccountId: body.adAccountId ?? "act_mock_001" });
    const job = {
      id: randomUUID(),
      tenantId: mockContext().tenantId,
      status: "succeeded",
      type: "meta_insights_sync",
      result: insights
    };
    getStore().jobs.set(job.id, job);
    return ok(job, 201);
  } catch (error) {
    return handleError(error);
  }
}
