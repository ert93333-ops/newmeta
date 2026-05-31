import { randomUUID } from "node:crypto";
import { handleError, ok, parseJson } from "@/lib/api/responses";
import { getStore, mockContext } from "@/lib/api/store";

export async function POST(request: Request) {
  try {
    const body = (await parseJson(request)) as Record<string, unknown>;
    const asset = {
      id: randomUUID(),
      tenantId: mockContext().tenantId,
      status: "created",
      ...body
    };
    getStore().assets.set(asset.id, asset);
    return ok({ asset }, 201);
  } catch (error) {
    return handleError(error);
  }
}
