# Meta Connection

Meta integration uses an adapter contract:

- `MetaGraphApiAdapter`: direct Graph/Marketing API calls for stable data and execution
- `MetaMcpAdapter`: AI agent integration surface
- `MockMetaAdapter`: tests and local development without ad spend

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

The OAuth callback response must not include token-shaped fields such as `token`, `access_token`, `refresh_token`, or `client_secret`. It may return connection status and whether encrypted token storage succeeded.

All create methods create PAUSED entities only. ACTIVE transition is separate and approval-gated.
