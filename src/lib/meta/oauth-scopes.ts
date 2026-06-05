export const REQUIRED_META_OAUTH_SCOPES = ["ads_read", "ads_management", "business_management"] as const;

export const OPTIONAL_META_OAUTH_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "instagram_basic",
  "instagram_manage_insights"
] as const;

export const DEFAULT_META_GRANTED_SCOPES = [
  ...REQUIRED_META_OAUTH_SCOPES,
  ...OPTIONAL_META_OAUTH_SCOPES
] as const;
