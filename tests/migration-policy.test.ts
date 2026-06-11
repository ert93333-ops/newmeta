import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Supabase migration guardrails", () => {
  const migrationsDir = join(process.cwd(), "supabase/migrations");
  const allMigrations = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => readFileSync(join(migrationsDir, name), "utf8"))
    .join("\n");
  const migration = readFileSync(
    join(process.cwd(), "supabase/migrations/20260531162030_hermes_foundation_schema.sql"),
    "utf8"
  );
  const metaDisconnectMigration = readFileSync(
    join(process.cwd(), "supabase/migrations/20260605055006_add_meta_disconnect_approval_action.sql"),
    "utf8"
  );
  const dataDeletionApprovalMigration = readFileSync(
    join(process.cwd(), "supabase/migrations/20260605060711_add_tenant_data_deletion_approval_action.sql"),
    "utf8"
  );
  const workerLifecycleMigration = readFileSync(
    join(process.cwd(), "supabase/migrations/20260605015446_worker_job_lifecycle.sql"),
    "utf8"
  );
  const dataDeletionStatusMigration = readFileSync(
    join(process.cwd(), "supabase/migrations/20260606150500_align_data_deletion_request_status.sql"),
    "utf8"
  );
  const dataDeletionExecutorMigration = readFileSync(
    join(process.cwd(), "supabase/migrations/20260611121500_tenant_data_deletion_executor.sql"),
    "utf8"
  );

  it("enables RLS and keeps security definer functions out of public schema", () => {
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("create schema if not exists private");
    expect(migration).toContain("function private.has_tenant_role");
  });

  it("does not define budget mutation approval actions", () => {
    expect(allMigrations).not.toContain("change_budget");
    expect(allMigrations).not.toContain("daily_budget'");
    expect(migration).toContain("approval_action_no_budget");
  });

  it("adds Meta disconnect as a destructive approval action without token mutation columns", () => {
    expect(metaDisconnectMigration).toContain("meta_disconnect_connection");
    expect(metaDisconnectMigration).not.toContain("encrypted_access_token");
    expect(metaDisconnectMigration).not.toContain("delete from");
  });

  it("adds tenant data deletion as an approval action without deletion SQL", () => {
    expect(dataDeletionApprovalMigration).toContain("tenant_data_deletion");
    expect(dataDeletionApprovalMigration).not.toContain("delete from");
    expect(dataDeletionApprovalMigration).not.toContain("drop table");
  });

  it("aligns data deletion request status with approval-required flow without deletion SQL", () => {
    expect(dataDeletionStatusMigration).toContain("data_deletion_request_status_enum");
    expect(dataDeletionStatusMigration).toContain("'approval_required'");
    expect(dataDeletionStatusMigration).toContain("alter table public.data_deletion_requests");
    expect(dataDeletionStatusMigration).not.toContain("delete from");
    expect(dataDeletionStatusMigration).not.toContain("drop table");
  });

  it("keeps worker job claiming in private schema", () => {
    expect(migration).toContain("function private.claim_creative_job");
    expect(migration).toContain("for update skip locked");
    expect(migration).not.toContain("function public.claim_creative_job");
  });

  it("keeps worker completion and retry lifecycle functions private", () => {
    expect(workerLifecycleMigration).toContain("function private.complete_creative_job");
    expect(workerLifecycleMigration).toContain("function private.fail_creative_job");
    expect(workerLifecycleMigration).toContain("attempts < max_attempts");
    expect(workerLifecycleMigration).toContain("grant execute on function private.complete_creative_job");
    expect(workerLifecycleMigration).toContain("grant execute on function private.fail_creative_job");
    expect(workerLifecycleMigration).not.toContain("function public.complete_creative_job");
    expect(workerLifecycleMigration).not.toContain("function public.fail_creative_job");
  });

  it("keeps tenant data deletion execution in a private service-role RPC", () => {
    expect(dataDeletionExecutorMigration).toContain("function private.execute_tenant_data_deletion");
    expect(dataDeletionExecutorMigration).toContain("grant execute on function private.execute_tenant_data_deletion");
    expect(dataDeletionExecutorMigration).toContain("to service_role");
    expect(dataDeletionExecutorMigration).not.toContain("to authenticated");
    expect(dataDeletionExecutorMigration).not.toContain("delete from public.tenants");
    expect(dataDeletionExecutorMigration).not.toContain("delete from public.audit_logs");
  });
});
