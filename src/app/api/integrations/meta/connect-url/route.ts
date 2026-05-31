import { ok } from "@/lib/api/responses";

const REQUIRED_SCOPES = ["ads_read", "ads_management", "business_management"];
const OPTIONAL_SCOPES = ["pages_show_list", "pages_read_engagement", "instagram_basic", "instagram_manage_insights"];

export function GET() {
  const appId = process.env.META_APP_ID ?? "mock-meta-app-id";
  const redirectUri = process.env.META_REDIRECT_URI ?? "http://localhost:3000/api/integrations/meta/callback";
  const scope = [...REQUIRED_SCOPES, ...OPTIONAL_SCOPES].join(",");
  const url = new URL("https://www.facebook.com/dialog/oauth");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", scope);
  url.searchParams.set("response_type", "code");

  return ok({
    connectUrl: url.toString(),
    requiredScopes: REQUIRED_SCOPES,
    optionalScopes: OPTIONAL_SCOPES,
    tokenPolicy: "고객에게 access token 직접 입력을 요구하지 않습니다."
  });
}
