import { randomUUID } from "node:crypto";
import { ok, parseJson } from "@/lib/api/responses";
import { resolveUserContext } from "@/lib/api/context";

export async function POST(request: Request) {
  const body = (await parseJson(request)) as { code?: string; scopes?: string[] };
  const context = await resolveUserContext(request);
  return ok(
    {
      connection: {
        id: randomUUID(),
        tenantId: context.tenantId,
        status: body.code ? "connected_mock" : "pending_code",
        scopes: body.scopes ?? ["ads_read"],
        encryptedTokenStored: Boolean(body.code)
      },
      token: "never_returned_to_client"
    },
    201
  );
}
