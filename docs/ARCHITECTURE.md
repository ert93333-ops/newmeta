# Architecture

Hermes is organized around a strict server-side orchestration path:

1. UI submits analysis, validation, draft, approval, or settings requests.
2. API routes validate tenant context, reject budget mutation payloads, apply RBAC, and run cost/approval checks.
3. Domain engines produce deterministic reports and preflight results.
4. Meta writes are routed through an adapter only after approval.
5. Long-running video/render/AI work is queued for a worker.
6. Supabase stores tenant-scoped state and audit records behind RLS.

## Modules

- `MetaAdapter`: Graph API, MCP, and Mock implementations behind the same contract.
- `Creative Analysis`: image checkers, video segment analysis, scoring.
- `Bottleneck Diagnosis`: funnel stages and data sufficiency thresholds for low-budget accounts.
- `Performance Fusion`: links creative observations to performance hypotheses without causal certainty.
- `Placement Validator`: aspect ratio, placement fit, and #1487569 prevention.
- `Draft Preflight`: page/link/creative/policy/cost/placement guard before draft creation.
- `Approval Center`: one-step or two-step approval depending on action risk.
- `Cost Guard`: provider-configured cost estimates, daily/monthly caps, cache-first behavior.

## Worker

The worker claims queued jobs through `private.claim_creative_job(worker_name)` using direct DB access. This keeps the privileged claim function outside exposed schemas and supports `FOR UPDATE SKIP LOCKED`.
