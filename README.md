# newmeta / Hermes

Hermes is an internal-first, SaaS-ready Meta Ads creative operations platform. It connects Meta ad accounts, analyzes image/video creatives, diagnoses funnel bottlenecks, validates placement compatibility, creates PAUSED drafts, and routes every risky action through approval.

## Non-Negotiable Guardrails

- Budget mutation is hard-blocked. The system can recommend budget changes, but it has no budget mutation approval action, API endpoint, or adapter method.
- External customer Meta access uses OAuth / Business Login. Customers are not asked to paste access tokens.
- Access tokens are encrypted server-side and never returned to the browser.
- Tenant data stays isolated by `tenant_id` and Supabase RLS.
- ACTIVE transitions and destructive actions require approval. Destructive actions require a second approval.
- Final ad images must not contain safezone, pixel, guide, or layout labels.
- Cross-tenant learning only uses anonymized, aggregated, opt-in patterns.

## Stack

- Next.js + TypeScript for UI and API orchestration
- Supabase Auth, Postgres, Storage-ready schema, and optional Edge Functions
- Separate worker process for long-running video/render/AI work
- Vitest for core engine and guardrail tests
- GitHub Actions CI for typecheck, tests, and build

## Quick Start

```bash
npm install
npm run typecheck
npm test
npm run build
npm run dev
```

Copy `.env.example` to `.env.local` for local Supabase/Meta credentials. Use `MockMetaAdapter` for safe development without ad spend.

For local development without a Supabase project, keep `HERMES_AUTH_MODE=mock`. Production requests should use Supabase Auth bearer tokens and `x-tenant-id`.

## Important Files

- `src/lib/guards/budget-guard.ts`: hard block for executable budget mutations
- `src/lib/approval/approval-policy.ts`: risk-level approval policy
- `src/lib/meta/*`: Meta adapter interface and mock/Graph/MCP adapters
- `src/lib/placement/placement-validator.ts`: placement and #1487569 preflight guard
- `src/lib/drafts/preflight.ts`: draft creation preflight
- `supabase/migrations/*_hermes_foundation_schema.sql`: tenant/RLS schema
- `worker/hermes-worker.ts`: DB-backed worker claim loop skeleton
- `docs/`: API, DB, security, cost, Meta, and operation notes

## Supabase Notes

The migration follows current Supabase RLS guidance: RLS is enabled on exposed tables, policies are scoped to the `authenticated` role, and authorization does not rely on user-editable metadata. Server-only keys and token encryption keys must stay out of `NEXT_PUBLIC_*`.

Relevant official docs checked during implementation:

- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Edge Function authentication](https://supabase.com/docs/guides/functions/auth)
- [Supabase Edge Function secrets](https://supabase.com/docs/guides/functions/secrets)

## GitHub

This folder has been initialized as a local Git repository and includes `.github/workflows/ci.yml`. A remote is not configured because no repository URL was provided.
