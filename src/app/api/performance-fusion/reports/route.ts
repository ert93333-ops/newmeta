import { randomUUID } from "node:crypto";
import { fuseCreativeAndPerformance } from "@/lib/performance/fusion";
import { handleError, ok, parseWriteJson } from "@/lib/api/responses";
import { resolveUserContext } from "@/lib/api/context";
import { getRepository } from "@/lib/repositories/hermes-repository";

type PerformanceFusionRequest = Parameters<typeof fuseCreativeAndPerformance>[0] & {
  assetId?: unknown;
  bottleneckJobId?: unknown;
};

export async function POST(request: Request) {
  try {
    const context = await resolveUserContext(request);
    const repository = getRepository();
    const body = (await parseWriteJson(request)) as PerformanceFusionRequest;
    const report = fuseCreativeAndPerformance(body);
    const persisted = await repository.savePerformanceFusionReport(request, {
      id: randomUUID(),
      tenantId: context.tenantId,
      createdBy: context.userId,
      assetId: readOptionalString(body.assetId),
      bottleneckJobId: readOptionalString(body.bottleneckJobId),
      reportJson: report,
      languageGuard: report.languageGuard
    });

    await repository.saveAuditLog(request, {
      tenantId: context.tenantId,
      userId: context.userId,
      action: "performance_fusion_report_created",
      objectType: "performance_fusion_report",
      objectId: persisted.id,
      afterJson: persisted,
      result: "created"
    });

    return ok(
      {
        id: persisted.id,
        tenantId: persisted.tenantId,
        createdBy: persisted.createdBy,
        assetId: persisted.assetId,
        bottleneckJobId: persisted.bottleneckJobId,
        createdAt: persisted.createdAt,
        updatedAt: persisted.updatedAt,
        ...report
      },
      201
    );
  } catch (error) {
    return handleError(error);
  }
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}
