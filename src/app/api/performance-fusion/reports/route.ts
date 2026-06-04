import { randomUUID } from "node:crypto";
import { fuseCreativeAndPerformance } from "@/lib/performance/fusion";
import { handleError, ok, parseWriteJson } from "@/lib/api/responses";
import { resolveUserContext } from "@/lib/api/context";

export async function POST(request: Request) {
  try {
    const context = await resolveUserContext(request);
    const body = (await parseWriteJson(request)) as Parameters<typeof fuseCreativeAndPerformance>[0];
    return ok(
      {
        id: randomUUID(),
        tenantId: context.tenantId,
        createdBy: context.userId,
        ...fuseCreativeAndPerformance(body)
      },
      201
    );
  } catch (error) {
    return handleError(error);
  }
}
