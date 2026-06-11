import { resolveUserContext } from "@/lib/api/context";
import { handleError, ok } from "@/lib/api/responses";
import { resolveMetaOAuthMode } from "@/lib/meta/oauth";
import { OPTIONAL_META_OAUTH_SCOPES, REQUIRED_META_OAUTH_SCOPES } from "@/lib/meta/oauth-scopes";
import { createMetaOAuthState } from "@/lib/meta/oauth-state";
import { assertRateLimit } from "@/lib/security/rate-limit";

export async function GET(request: Request) {
  try {
    assertRateLimit(request, { keyPrefix: "meta-oauth-connect", limit: 30, windowMs: 60_000 });
    const context = await resolveUserContext(request);
    const state = createMetaOAuthState(context);
    const oauthMode = resolveMetaOAuthMode();
    const appId = oauthMode === "live" ? readRequiredEnv("META_APP_ID") : process.env.META_APP_ID?.trim() || "mock-meta-app-id";
    const redirectUri =
      oauthMode === "live"
        ? readRequiredEnv("META_REDIRECT_URI")
        : process.env.META_REDIRECT_URI?.trim() || "http://localhost:3000/api/integrations/meta/callback";
    const scope = [...REQUIRED_META_OAUTH_SCOPES, ...OPTIONAL_META_OAUTH_SCOPES].join(",");
    const url = new URL("https://www.facebook.com/dialog/oauth");
    url.searchParams.set("client_id", appId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", scope);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state.value);

    return ok({
      connectUrl: url.toString(),
      requiredScopes: REQUIRED_META_OAUTH_SCOPES,
      optionalScopes: OPTIONAL_META_OAUTH_SCOPES,
      stateBound: true,
      stateExpiresAt: state.expiresAt,
      tokenPolicy: "Customers are never asked to paste access tokens."
    });
  } catch (error) {
    return handleError(error);
  }
}

function readRequiredEnv(key: "META_APP_ID" | "META_REDIRECT_URI"): string {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error("META_OAUTH_LIVE_NOT_CONFIGURED");
  }
  return value;
}
