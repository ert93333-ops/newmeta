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

`GET /api/integrations/meta/connect-url` returns a Meta OAuth URL containing a signed, 10-minute `state` value. The state is bound to the current authenticated user and tenant through HMAC-derived hashes, not raw user or tenant ids.

The dashboard Meta Connection panel is the browser entry point for this route. It persists the selected tenant id to both `sessionStorage` and `localStorage` under `hermes:tenant-id`, sends that tenant as the `x-tenant-id` header, and forwards the current Supabase browser session bearer when one exists. The panel does not render any Meta token, app secret, or direct credential input.

`GET /api/integrations/meta/callback` is the browser redirect target. It does not exchange or store Meta tokens. Instead it forwards `code` and `state` to `/meta/oauth/callback` in the URL fragment so the code is not sent back to the server as a query string on the client handoff page.

`/meta/oauth/callback` reads the fragment client-side, clears it from browser history, retrieves the current Supabase browser session when available, and calls `POST /api/integrations/meta/callback`. Production callers must still provide the same tenant context used to create the connect URL, for example through the `hermes:tenant-id` browser storage key.

`POST /api/integrations/meta/callback` requires both the authorization `code` and matching `state`. It verifies the state before exchanging the code server-side, encrypting the resulting Meta token with AES-GCM, and storing only encrypted token material in `meta_connections`. Local development may use `HERMES_META_OAUTH_MODE=mock`; release must use `HERMES_META_OAUTH_MODE=live`.

The OAuth callback response must not include token-shaped fields such as `token`, `access_token`, `refresh_token`, or `client_secret`. It may return connection status and whether encrypted token storage succeeded.

The OAuth callback request accepts authorization `code` and signed `state` values only. Direct token payload fields such as `access_token`, `refresh_token`, and `client_secret` are rejected by the guarded API JSON boundary.

Release deployments must configure `HERMES_OAUTH_STATE_SECRET` with at least 32 characters. Non-production mock mode can fall back to `TOKEN_ENCRYPTION_KEY` for local-only state signing, but production fails closed without the dedicated state secret.

All create methods create PAUSED entities only. ACTIVE transition is separate and approval-gated.
