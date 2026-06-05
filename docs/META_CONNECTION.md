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

In local mock mode this route may fall back to mock app metadata for safe development. In live mode it must not guess. Missing `META_APP_ID` or `META_REDIRECT_URI` now returns `META_OAUTH_LIVE_NOT_CONFIGURED` instead of emitting a localhost redirect or mock app id.

The dashboard Meta Connection panel is the browser entry point for this route. It first uses `/api/me` with the current Supabase browser session bearer to load visible tenant memberships when available. It persists the selected tenant id to both `sessionStorage` and `localStorage` under `hermes:tenant-id`, sends that tenant as the `x-tenant-id` header, and forwards the current Supabase browser session bearer when one exists. The panel does not render any Meta token, app secret, or direct credential input.

`GET /api/integrations/meta/callback` is the browser redirect target. It does not exchange or store Meta tokens. Instead it forwards `code` and `state` to `/meta/oauth/callback` in the URL fragment so the code is not sent back to the server as a query string on the client handoff page. Production handoff requires `HERMES_APP_URL` or `NEXT_PUBLIC_APP_URL`; if neither is configured, the route returns `PUBLIC_APP_URL_REQUIRED` instead of falling back to the request origin.

`/meta/oauth/callback` reads the fragment client-side, clears it from browser history, retrieves the current Supabase browser session when available, and calls `POST /api/integrations/meta/callback`. Production callers must still provide the same tenant context used to create the connect URL, for example through the `hermes:tenant-id` browser storage key.

`POST /api/integrations/meta/callback` requires both the authorization `code` and matching `state`. It verifies the state before exchanging the code server-side, resolves granted scopes from Meta server-side, verifies that the required scope set was actually granted, encrypts the resulting Meta token with AES-GCM, and stores only encrypted token material in `meta_connections`. Local development may use `HERMES_META_OAUTH_MODE=mock`; release must use `HERMES_META_OAUTH_MODE=live`.

Read routes resolve their adapter server-side from the latest tenant-scoped `meta_connections` row. When the stored connection metadata says `mode=live`, the route decrypts the access token with `TOKEN_ENCRYPTION_KEY` and uses `MetaGraphApiAdapter`. When no connection exists, only non-production runtime may fall back to `MockMetaAdapter`; production fails closed with `META_CONNECTION_REQUIRED`. Stored live connections are also revalidated against the required scope set at runtime, so older incomplete rows fail closed with `META_REQUIRED_SCOPES_MISSING`. Stored mock connections are local-only and fail closed in production.

`DELETE /api/integrations/meta/:id` is also tenant-scoped at lookup time. Hermes now requires the exact `meta_connections.id` to exist for the current tenant before it writes a destructive disconnect approval. Unknown ids and cross-tenant ids fail closed with `META_CONNECTION_NOT_FOUND` instead of leaving an approval record that targets an arbitrary object id. Once that destructive approval is fully approved and executed, Hermes scrubs the stored encrypted token material, clears scopes and expiry, and marks the row `revoked` so live adapter resolution cannot reuse the connection.

The live PAUSED draft executor also uses `MetaGraphApiAdapter` server-side. It performs the write chain with server-only `Authorization: Bearer` headers for:

- `/{ad_account_id}/adimages` or `/{ad_account_id}/advideos`
- `/{ad_account_id}/adcreatives`
- `/{ad_account_id}/campaigns`
- `/{ad_account_id}/adsets`
- `/{ad_account_id}/ads`

Live draft execution requires a persisted creative asset `sourceUrl`. Video creatives additionally require a `thumbnailUrl` in the route payload so the preview image does not have to be inferred from the token-protected upload path. Before approval creation or execution, the server also validates the live ad set payload: targeting must be non-empty, `OFFSITE_CONVERSIONS` requires `promotedObject.pixel_id` plus a conversion event, catalog sales require `promotedObject.product_catalog_id`, and app promotion requires `promotedObject.application_id` plus `object_store_url`.

For campaign and ad set payloads, the live executor now uses Meta's documented `execution_options=["validate_only"]` support before the real create call. This surfaces provider validation errors earlier and returns sanitized provider details without exposing the bearer token.

If a later live create step fails after earlier Meta objects were already created, Hermes records those partial ids in the approval execution result and audit log, then cancels the approval. This prevents the same approval from being retried blindly and creating duplicate upstream objects.

The OAuth callback response must not include token-shaped fields such as `token`, `access_token`, `refresh_token`, or `client_secret`. It may return connection status and whether encrypted token storage succeeded.

The OAuth callback request accepts authorization `code` and signed `state` values only. Direct token payload fields such as `access_token`, `refresh_token`, and `client_secret` are rejected by the guarded API JSON boundary. A browser-supplied `scopes` array is not authoritative; Hermes stores server-resolved granted scopes only and refuses live connections that are missing required scopes.

Release deployments must configure `HERMES_OAUTH_STATE_SECRET` with at least 32 characters. Non-production mock mode can fall back to `TOKEN_ENCRYPTION_KEY` for local-only state signing, but production fails closed without the dedicated state secret.

All create methods create PAUSED entities only. ACTIVE transition is separate and approval-gated.
