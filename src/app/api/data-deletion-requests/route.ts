import { randomUUID } from "node:crypto";
import { ok, parseJson } from "@/lib/api/responses";
import { mockContext } from "@/lib/api/store";

export async function POST(request: Request) {
  const body = (await parseJson(request)) as { scope?: string };
  return ok(
    {
      id: randomUUID(),
      tenantId: mockContext().tenantId,
      status: "queued",
      scope: body.scope ?? "tenant",
      deletes: ["tokens", "assets", "reports", "learning patterns", "integration data"]
    },
    201
  );
}
