import { NextResponse } from "next/server";
import { handleError, ok, parseWriteJson } from "@/lib/api/responses";
import { isProductionRuntime, resolveUserContext } from "@/lib/api/context";
import { connectMetaOAuth } from "@/lib/meta/oauth";
import { verifyMetaOAuthState } from "@/lib/meta/oauth-state";
import { getRepository } from "@/lib/repositories/hermes-repository";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const error = readOptionalString(url.searchParams.get("error"));
    if (error) {
      return redirectToClientCallback(request, {
        error,
        errorDescription: readOptionalString(url.searchParams.get("error_description"))
      });
    }
    const code = readCode(url.searchParams.get("code"));
    const state = readState(url.searchParams.get("state"));

    return redirectToClientCallback(request, { code, state });
  } catch (error) {
    return handleError(error);
  }
}

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

function redirectToClientCallback(
  request: Request,
  params: { code?: string; state?: string; error?: string; errorDescription?: string }
): NextResponse {
  const target = new URL("/meta/oauth/callback", publicAppOrigin(request));
  const fragment = new URLSearchParams();
  if (params.code) {
    fragment.set("code", params.code);
  }
  if (params.state) {
    fragment.set("state", params.state);
  }
  if (params.error) {
    fragment.set("error", params.error);
  }
  if (params.errorDescription) {
    fragment.set("error_description", params.errorDescription);
  }

  const redirectUrl = `${target.toString()}#${fragment.toString()}`;
  return NextResponse.redirect(redirectUrl, 303);
}

function publicAppOrigin(request: Request): string {
  const configured = process.env.HERMES_APP_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) {
    return configured;
  }
  if (isProductionRuntime()) {
    throw new Error("PUBLIC_APP_URL_REQUIRED");
  }
  const url = new URL(request.url);
  return url.origin;
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

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readScopes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return ["ads_read"];
  }
  const scopes = value.filter((scope): scope is string => typeof scope === "string" && scope.trim().length > 0);
  return scopes.length > 0 ? Array.from(new Set(scopes.map((scope) => scope.trim()))) : ["ads_read"];
}
