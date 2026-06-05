import { randomUUID } from "node:crypto";
import { fail, handleError, ok, parseWriteJson } from "@/lib/api/responses";
import { resolveUserContext } from "@/lib/api/context";
import { getRepository } from "@/lib/repositories/hermes-repository";
import { resolveMetaAdapter } from "@/lib/meta/resolve-meta-adapter";

export async function POST(request: Request) {
  try {
    const context = await resolveUserContext(request);
    const body = (await parseWriteJson(request)) as {
      adAccountId?: string;
      level?: "account" | "campaign" | "adset" | "ad";
      datePreset?: "today" | "yesterday" | "last_7d" | "last_30d" | "maximum";
      breakdowns?: string[];
    };
    const repository = getRepository();
    const resolved = await resolveMetaAdapter({
      request,
      context,
      repository
    });
    const adAccountId = body.adAccountId ?? (resolved.mode === "mock" ? "act_mock_001" : undefined);
    if (!adAccountId) {
      return fail("META_AD_ACCOUNT_REQUIRED", "Meta ad account id is required for live insights sync.", 400);
    }

    const insights = await resolved.adapter.getInsights({
      adAccountId,
      level: body.level,
      datePreset: body.datePreset,
      breakdowns: body.breakdowns
    });
    const job = {
      id: randomUUID(),
      tenantId: context.tenantId,
      createdBy: context.userId,
      status: "succeeded",
      type: "meta_insights_sync",
      input: {
        adAccountId,
        level: body.level ?? "ad",
        datePreset: body.datePreset ?? "last_30d",
        breakdowns: body.breakdowns ?? [],
        adapterMode: resolved.mode
      },
      result: insights
    };
    await repository.saveJob(request, job);
    await repository.saveAuditLog(request, {
      tenantId: context.tenantId,
      userId: context.userId,
      action: "meta_insights_sync",
      objectType: "ad_account",
      objectId: adAccountId,
      afterJson: {
        jobId: job.id,
        adapterMode: resolved.mode,
        breakdowns: body.breakdowns ?? []
      },
      result: "succeeded"
    });

    return ok(job, 201);
  } catch (error) {
    return handleError(error);
  }
}
