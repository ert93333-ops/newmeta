import { afterEach, describe, expect, it } from "vitest";
import { approveRequest, createApprovalRequest } from "@/lib/approval/approval-policy";
import {
  configuredApprovalExecutionMode,
  planApprovalExecution
} from "@/lib/approval/execution-policy";
import { MemoryHermesRepository } from "@/lib/repositories/hermes-repository";
import { POST as executeApproval } from "@/app/api/approvals/[id]/execute/route";
import type { UserContext } from "@/lib/types";

const ENV_KEYS = [
  "NODE_ENV",
  "VERCEL_ENV",
  "HERMES_AUTH_MODE",
  "HERMES_APPROVAL_EXECUTION_MODE",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
] as const;

const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const mutableEnv = process.env as unknown as Record<string, string | undefined>;
const tenantId = "00000000-0000-0000-0000-000000000001";

const requester: UserContext = {
  userId: "requester",
  tenantId,
  role: "marketer"
};

const approver: UserContext = {
  userId: "approver",
  tenantId,
  role: "owner"
};

function setEnv(key: (typeof ENV_KEYS)[number], value: string): void {
  mutableEnv[key] = value;
}

function unsetEnv(key: (typeof ENV_KEYS)[number]): void {
  delete mutableEnv[key];
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = ORIGINAL_ENV[key];
    if (value === undefined) {
      unsetEnv(key);
    } else {
      setEnv(key, value);
    }
  }
}

function clearEnv(): void {
  for (const key of ENV_KEYS) {
    unsetEnv(key);
  }
}

function approvedRequest() {
  return approveRequest(
    createApprovalRequest({
      context: requester,
      action: "meta_create_ad_paused",
      objectType: "ad",
      afterJson: { status: "PAUSED" }
    }),
    approver
  );
}

describe("approval execution", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("allows mock execution only outside production", () => {
    clearEnv();
    setEnv("HERMES_APPROVAL_EXECUTION_MODE", "mock");

    expect(configuredApprovalExecutionMode()).toBe("mock");
    expect(planApprovalExecution("meta_create_ad_paused")).toEqual({
      mode: "mock",
      result: "mock_executed_server_side"
    });
  });

  it("blocks mock execution in production", () => {
    clearEnv();
    setEnv("VERCEL_ENV", "production");
    setEnv("HERMES_APPROVAL_EXECUTION_MODE", "mock");

    expect(() => planApprovalExecution("meta_create_ad_paused")).toThrow("MOCK_EXECUTION_DISABLED_IN_PRODUCTION");
  });

  it("blocks live execution until a live executor is configured", () => {
    clearEnv();
    setEnv("HERMES_APPROVAL_EXECUTION_MODE", "live");

    expect(() => planApprovalExecution("meta_create_ad_paused")).toThrow("LIVE_APPROVAL_EXECUTOR_NOT_CONFIGURED");
  });

  it("hard-blocks budget mutation payloads before marking an approval executed", async () => {
    clearEnv();
    setEnv("HERMES_AUTH_MODE", "mock");
    const repository = new MemoryHermesRepository();
    const approval = approvedRequest();
    await repository.saveApproval(new Request("http://localhost/api/test"), approval);

    const response = await executeApproval(
      new Request(`http://localhost/api/approvals/${approval.id}/execute`, {
        method: "POST",
        body: JSON.stringify({ actionPayload: { daily_budget: 50000 } })
      }),
      { params: Promise.resolve({ id: approval.id }) }
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("BUDGET_MUTATION_HARD_BLOCKED");
  });
});
