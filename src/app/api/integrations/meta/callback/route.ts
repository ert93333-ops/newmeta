import { handleError, ok, parseWriteJson } from "@/lib/api/responses";
import { resolveUserContext } from "@/lib/api/context";
import { connectMetaOAuth } from "@/lib/meta/oauth";
import { verifyMetaOAuthState } from "@/lib/meta/oauth-state";
import { getRepository } from "@/lib/repositories/hermes-repository";

export async function POST(request: Request) {
  try {
    const body = (await parseWriteJson(request)) as { code?: unknown; scopes?: unknown; state?: unknown };
    const context = await resolveUserContext(request);
    const code = readCode(body.code);
    verifyMetaOAuthState(readState(body.state), context);
    const repository = getRepository();
    const connection = await connectMetaOAuth({
      request,
      context,
      repository,
      code,
      scopes: readScopes(body.scopes)
    });

    return ok({ connection }, 201);
  } catch (error) {
    return handleError(error);
  }
}

function readCode(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("META_OAUTH_CODE_REQUIRED");
  }
  return value.trim();
}

function readState(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("META_OAUTH_STATE_REQUIRED");
  }
  return value.trim();
}

function readScopes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return ["ads_read"];
  }
  const scopes = value.filter((scope): scope is string => typeof scope === "string" && scope.trim().length > 0);
  return scopes.length > 0 ? Array.from(new Set(scopes.map((scope) => scope.trim()))) : ["ads_read"];
}
