import { randomUUID } from "node:crypto";
import { handleError, ok, parseWriteJson } from "@/lib/api/responses";
import { resolveUserContext } from "@/lib/api/context";
import { getRepository } from "@/lib/repositories/hermes-repository";

export async function POST(request: Request) {
  try {
    const context = await resolveUserContext(request);
    const body = (await parseWriteJson(request)) as Record<string, unknown>;
    const asset = {
      id: randomUUID(),
      tenantId: context.tenantId,
      createdBy: context.userId,
      status: "created",
      ...body
    };
    await getRepository().saveAsset(request, asset);
    return ok({ asset }, 201);
  } catch (error) {
    return handleError(error);
  }
}
