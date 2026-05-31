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

All create methods create PAUSED entities only. ACTIVE transition is separate and approval-gated.
