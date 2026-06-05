import { randomUUID } from "node:crypto";
import { handleError, ok, parseWriteJson } from "@/lib/api/responses";
import { resolveUserContext } from "@/lib/api/context";
import { validatePlacement } from "@/lib/placement/placement-validator";
import { getRepository } from "@/lib/repositories/hermes-repository";
import type { PlacementValidationInput } from "@/lib/placement/placement-validator";

type PlacementValidationRequest = PlacementValidationInput & {
  assetId?: unknown;
};

export async function POST(request: Request) {
  try {
    const context = await resolveUserContext(request);
    const repository = getRepository();
    const body = (await parseWriteJson(request)) as PlacementValidationRequest;
    const report = validatePlacement(body);
    const persisted = await repository.savePlacementValidationReport(request, {
      id: randomUUID(),
      tenantId: context.tenantId,
      createdBy: context.userId,
      assetId: readOptionalString(body.assetId),
      placements: body.placements,
      status: report.status,
      error1487569Risk: report.error1487569Risk,
      reportJson: report
    });

    await repository.saveAuditLog(request, {
      tenantId: context.tenantId,
      userId: context.userId,
      action: "placement_validation_report_created",
      objectType: "placement_validation_report",
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
