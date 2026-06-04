import { randomUUID } from "node:crypto";
import { handleError, ok, parseWriteJson } from "@/lib/api/responses";
import { resolveUserContext } from "@/lib/api/context";
import { getRepository } from "@/lib/repositories/hermes-repository";

export async function POST(request: Request) {
  try {
    const context = await resolveUserContext(request);
    const body = (await parseWriteJson(request)) as { scope?: string };
    const deletionRequest = {
      id: randomUUID(),
      tenantId: context.tenantId,
      createdBy: context.userId,
      status: "queued",
      scope: body.scope ?? "tenant",
      deletes: ["tokens", "assets", "reports", "learning patterns", "integration data"]
    };
    await getRepository().saveAuditLog(request, {
      tenantId: context.tenantId,
      userId: context.userId,
      action: "data_deletion_requested",
      objectType: "tenant",
      objectId: context.tenantId,
      afterJson: deletionRequest,
      result: "queued"
    });
    return ok(deletionRequest, 201);
  } catch (error) {
    return handleError(error);
  }
}
