# Meta Connection

Meta integration uses an adapter contract:

- `MetaGraphApiAdapter`: direct Graph/Marketing API calls for stable data and execution
- `MetaMcpAdapter`: AI agent integration surface
- `MockMetaAdapter`: tests and local development without ad spend

`MetaGraphApiAdapter` must send customer/server tokens through server-side `Authorization: Bearer` headers only. It must not append tokens to Graph API URLs or accept token-shaped fields in request params/body.

Required candidate scopes:

- `ads_read`
- `ads_management`
- `business_management`

Optional expansion scopes:

- `pages_show_list`
- `pages_read_engagement`
- `instagram_basic`
- `instagram_manage_insights`
- `catalog_management` when needed

External customer connections must use OAuth / Business Login. Customers must not paste access tokens.

`POST /api/integrations/meta/callback` exchanges the authorization code server-side, encrypts the resulting Meta token with AES-GCM, and stores only encrypted token material in `meta_connections`. Local development may use `HERMES_META_OAUTH_MODE=mock`; release must use `HERMES_META_OAUTH_MODE=live`.

The OAuth callback response must not include token-shaped fields such as `token`, `access_token`, `refresh_token`, or `client_secret`. It may return connection status and whether encrypted token storage succeeded.

The OAuth callback request accepts authorization `code` values only. Direct token payload fields such as `access_token`, `refresh_token`, and `client_secret` are rejected by the guarded API JSON boundary.

All create methods create PAUSED entities only. ACTIVE transition is separate and approval-gated.
