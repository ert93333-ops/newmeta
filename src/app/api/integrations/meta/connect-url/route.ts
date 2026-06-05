import { resolveUserContext } from "@/lib/api/context";
import { handleError, ok } from "@/lib/api/responses";
import { createMetaOAuthState } from "@/lib/meta/oauth-state";

const REQUIRED_SCOPES = ["ads_read", "ads_management", "business_management"];
const OPTIONAL_SCOPES = ["pages_show_list", "pages_read_engagement", "instagram_basic", "instagram_manage_insights"];

export async function GET(request: Request) {
  try {
    const context = await resolveUserContext(request);
    const state = createMetaOAuthState(context);
    const appId = process.env.META_APP_ID ?? "mock-meta-app-id";
    const redirectUri = process.env.META_REDIRECT_URI ?? "http://localhost:3000/api/integrations/meta/callback";
    const scope = [...REQUIRED_SCOPES, ...OPTIONAL_SCOPES].join(",");
    const url = new URL("https://www.facebook.com/dialog/oauth");
    url.searchParams.set("client_id", appId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", scope);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state.value);

    return ok({
      connectUrl: url.toString(),
      requiredScopes: REQUIRED_SCOPES,
      optionalScopes: OPTIONAL_SCOPES,
      stateBound: true,
      stateExpiresAt: state.expiresAt,
      tokenPolicy: "Customers are never asked to paste access tokens."
    });
  } catch (error) {
    return handleError(error);
  }
}
