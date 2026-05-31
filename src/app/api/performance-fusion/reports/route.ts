import { randomUUID } from "node:crypto";
import { fuseCreativeAndPerformance } from "@/lib/performance/fusion";
import { handleError, ok, parseJson } from "@/lib/api/responses";
import { mockContext } from "@/lib/api/store";

export async function POST(request: Request) {
  try {
    const body = (await parseJson(request)) as Parameters<typeof fuseCreativeAndPerformance>[0];
    return ok(
      {
        id: randomUUID(),
        tenantId: mockContext().tenantId,
        ...fuseCreativeAndPerformance(body)
      },
      201
    );
  } catch (error) {
    return handleError(error);
  }
}
