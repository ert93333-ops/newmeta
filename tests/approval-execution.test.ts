import { afterEach, describe, expect, it } from "vitest";
import { approveRequest, createApprovalRequest } from "@/lib/approval/approval-policy";
import {
  configuredApprovalExecutionMode,
  executeApprovedAction,
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

const secondApprover: UserContext = {
  userId: "approver-2",
  tenantId,
  role: "admin"
};

const disconnectRequester: UserContext = {
  userId: "requester-admin",
  tenantId,
  role: "admin"
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

function approvedActivateAdRequest() {
  return approveRequest(
    createApprovalRequest({
      context: requester,
      action: "meta_activate_ad",
      objectType: "ad",
      objectId: "ad-live-1",
      afterJson: { status: "ACTIVE" }
    }),
    approver,
    { typedConfirmation: "APPROVE meta_activate_ad" }
  );
}

function approvedPaidGenerationRequest() {
  return approveRequest(
    createApprovalRequest({
      context: requester,
      action: "ai_paid_generation",
      objectType: "variant_batch",
      objectId: "creative-control-1",
      afterJson: {
        operationType: "variant_batch",
        providerName: "mock-ai",
        estimatedCredits: 5,
        estimatedCostKrw: 5
      }
    }),
    approver
  );
}

function approvedDisconnectRequest() {
  const pending = createApprovalRequest({
    context: disconnectRequester,
    action: "meta_disconnect_connection",
    objectType: "meta_connection",
    objectId: "connection-live-1",
    afterJson: {
      status: "disconnect_requested"
    }
  });
  const firstApproved = approveRequest(pending, approver, {
    typedConfirmation: "APPROVE meta_disconnect_connection"
  });
  return approveRequest(firstApproved, secondApprover, {
    typedConfirmation: "APPROVE meta_disconnect_connection"
  });
}

describe("approval execution", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("allows mock execution only outside production", () => {
    clearEnv();
    setEnv("HERMES_APPROVAL_EXECUTION_MODE", "mock");

    expect(configuredApprovalExecutionMode()).toBe("mock");
    expect(planApprovalExecution("meta_activate_ad")).toEqual({
      mode: "mock",
      result: "mock_activated_ad"
    });
    expect(executeApprovedAction(approvedActivateAdRequest())).toMatchObject({
      mode: "mock",
      operation: "meta_activate_ad",
      result: "mock_activated_ad",
      externalStatus: "ACTIVE"
    });
  });

  it("requires the paused draft domain route for paused-draft approvals", () => {
    clearEnv();
    setEnv("HERMES_APPROVAL_EXECUTION_MODE", "mock");

    expect(() => planApprovalExecution("meta_create_ad_paused")).toThrow("APPROVAL_ACTION_EXECUTOR_REQUIRED");
    expect(() => executeApprovedAction(approvedRequest())).toThrow("APPROVAL_ACTION_EXECUTOR_REQUIRED");
  });

  it("blocks mock execution in production", () => {
    clearEnv();
    setEnv("VERCEL_ENV", "production");
    setEnv("HERMES_APPROVAL_EXECUTION_MODE", "mock");

    expect(() => planApprovalExecution("meta_activate_ad")).toThrow("MOCK_EXECUTION_DISABLED_IN_PRODUCTION");
  });

  it("blocks live execution until a live executor is configured", () => {
    clearEnv();
    setEnv("HERMES_APPROVAL_EXECUTION_MODE", "live");

    expect(() => planApprovalExecution("meta_activate_ad")).toThrow("LIVE_APPROVAL_EXECUTOR_NOT_CONFIGURED");
  });

  it("keeps Meta connection disconnect execution approval-gated and mock-safe outside production", () => {
    clearEnv();
    setEnv("HERMES_APPROVAL_EXECUTION_MODE", "mock");

    expect(planApprovalExecution("meta_disconnect_connection")).toEqual({
      mode: "mock",
      result: "mock_disconnected_meta_connection"
    });
  });

  it("keeps tenant data deletion execution approval-gated and mock-safe outside production", () => {
    clearEnv();
    setEnv("HERMES_APPROVAL_EXECUTION_MODE", "mock");

    expect(planApprovalExecution("tenant_data_deletion")).toEqual({
      mode: "mock",
      result: "mock_tenant_data_deletion_recorded"
    });
  });

  it("does not let the generic executor dispatch paid AI generation", () => {
    clearEnv();
    setEnv("HERMES_APPROVAL_EXECUTION_MODE", "mock");

    expect(() => planApprovalExecution("ai_paid_generation")).toThrow("PAID_OPERATION_EXECUTOR_REQUIRED");
    expect(() => executeApprovedAction(approvedPaidGenerationRequest())).toThrow("PAID_OPERATION_EXECUTOR_REQUIRED");
  });

  it("rechecks stored approval payloads for budget mutations before dispatch", () => {
    clearEnv();
    const contaminatedApproval = {
      ...approvedActivateAdRequest(),
      afterJson: {
        daily_budget: 50000
      }
    };

    expect(() => executeApprovedAction(contaminatedApproval)).toThrowError(
      expect.objectContaining({
        code: "BUDGET_MUTATION_HARD_BLOCKED"
      })
    );
  });

  it("rechecks stored approval expiry before dispatch", () => {
    clearEnv();
    const expiredApproval = {
      ...approvedActivateAdRequest(),
      expiresAt: new Date(Date.now() - 1000).toISOString()
    };

    expect(() => executeApprovedAction(expiredApproval)).toThrow("APPROVAL_EXPIRED");
  });

  it("hard-blocks budget mutation payloads before marking an approval executed", async () => {
    clearEnv();
    setEnv("HERMES_AUTH_MODE", "mock");
    const repository = new MemoryHermesRepository();
    const approval = approvedActivateAdRequest();
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

  it("blocks expired approvals before dispatching execution", async () => {
    clearEnv();
    setEnv("HERMES_AUTH_MODE", "mock");
    const repository = new MemoryHermesRepository();
    const approval = {
      ...approvedActivateAdRequest(),
      expiresAt: new Date(Date.now() - 1000).toISOString()
    };
    await repository.saveApproval(new Request("http://localhost/api/test"), approval);

    const response = await executeApproval(
      new Request(`http://localhost/api/approvals/${approval.id}/execute`, {
        method: "POST"
      }),
      { params: Promise.resolve({ id: approval.id }) }
    );
    const body = await response.json();
    const stored = await repository.getApproval(new Request("http://localhost/api/test"), approver, approval.id);

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("APPROVAL_EXPIRED");
    expect(stored?.status).toBe("approved");
    expect(stored?.executionResultJson).toBeUndefined();
  });

  it("keeps paused-draft approvals approved when generic execution is requested", async () => {
    clearEnv();
    setEnv("HERMES_AUTH_MODE", "mock");
    const repository = new MemoryHermesRepository();
    const approval = approvedRequest();
    await repository.saveApproval(new Request("http://localhost/api/test"), approval);

    const response = await executeApproval(
      new Request(`http://localhost/api/approvals/${approval.id}/execute`, {
        method: "POST"
      }),
      { params: Promise.resolve({ id: approval.id }) }
    );
    const body = await response.json();
    const stored = await repository.getApproval(new Request("http://localhost/api/test"), approver, approval.id);

    expect(response.status).toBe(501);
    expect(body.error.code).toBe("APPROVAL_ACTION_EXECUTOR_REQUIRED");
    expect(body.error.details).toMatchObject({
      action: "meta_create_ad_paused",
      route: "/api/drafts/create-paused"
    });
    expect(stored?.status).toBe("approved");
    expect(stored?.executionResultJson).toBeUndefined();
  });

  it("keeps paid AI generation approvals approved when generic execution is requested", async () => {
    clearEnv();
    setEnv("HERMES_AUTH_MODE", "mock");
    const repository = new MemoryHermesRepository();
    const approval = approvedPaidGenerationRequest();
    await repository.saveApproval(new Request("http://localhost/api/test"), approval);

    const response = await executeApproval(
      new Request(`http://localhost/api/approvals/${approval.id}/execute`, {
        method: "POST"
      }),
      { params: Promise.resolve({ id: approval.id }) }
    );
    const body = await response.json();
    const stored = await repository.getApproval(new Request("http://localhost/api/test"), approver, approval.id);
    const usage = await repository.listCostUsage(new Request("http://localhost/api/test"), approver);

    expect(response.status).toBe(501);
    expect(body.error.code).toBe("PAID_OPERATION_EXECUTOR_REQUIRED");
    expect(body.error.details.action).toBe("ai_paid_generation");
    expect(stored?.status).toBe("approved");
    expect(stored?.executionResultJson).toBeUndefined();
    expect(usage).toHaveLength(0);
  });

  it("persists action-specific execution details before returning success", async () => {
    clearEnv();
    setEnv("HERMES_AUTH_MODE", "mock");
    const repository = new MemoryHermesRepository();
    const approval = approvedActivateAdRequest();
    await repository.saveApproval(new Request("http://localhost/api/test"), approval);

    const response = await executeApproval(
      new Request(`http://localhost/api/approvals/${approval.id}/execute`, {
        method: "POST"
      }),
      { params: Promise.resolve({ id: approval.id }) }
    );
    const body = await response.json();
    const stored = await repository.getApproval(
      new Request("http://localhost/api/test"),
      { ...approver, userId: "00000000-0000-0000-0000-000000000010" },
      approval.id
    );

    expect(response.status).toBe(200);
    expect(body.approval).toMatchObject({
      id: approval.id,
      status: "executed",
      executionResultJson: {
        result: "mock_activated_ad",
        operation: "meta_activate_ad",
        externalStatus: "ACTIVE"
      }
    });
    expect(stored?.executionResultJson).toEqual(body.executionDetails);
  });

  it("executes a Meta disconnect approval by revoking stored token material", async () => {
    clearEnv();
    setEnv("HERMES_AUTH_MODE", "mock");
    const repository = new MemoryHermesRepository();
    await repository.saveMetaConnection(new Request("http://localhost/api/test"), {
      id: "connection-live-1",
      tenantId,
      createdBy: requester.userId,
      provider: "meta",
      connectionMode: "oauth",
      encryptedAccessToken: "encrypted-token",
      tokenIv: "token-iv",
      tokenAuthTag: "token-tag",
      tokenKid: "primary",
      scopes: ["ads_read", "ads_management", "business_management"],
      expiresAt: "2026-06-07T00:00:00.000Z",
      status: "connected",
      metadataJson: {
        label: "primary-meta"
      }
    });
    const approval = approvedDisconnectRequest();
    await repository.saveApproval(new Request("http://localhost/api/test"), approval);

    const response = await executeApproval(
      new Request(`http://localhost/api/approvals/${approval.id}/execute`, {
        method: "POST"
      }),
      { params: Promise.resolve({ id: approval.id }) }
    );
    const body = await response.json();
    const storedApproval = await repository.getApproval(new Request("http://localhost/api/test"), approver, approval.id);
    const storedConnection = await repository.getMetaConnection(
      new Request("http://localhost/api/test"),
      approver,
      "connection-live-1"
    );

    expect(response.status).toBe(200);
    expect(body.execution).toBe("mock_disconnected_meta_connection");
    expect(body.executionDetails).toMatchObject({
      operation: "meta_disconnect_connection",
      externalObjectId: "connection-live-1",
      externalStatus: "DELETED",
      details: {
        previousStatus: "connected",
        disconnectedStatus: "revoked",
        tokenMaterialCleared: true
      }
    });
    expect(storedApproval?.status).toBe("executed");
    expect(storedApproval?.executionResultJson).toEqual(body.executionDetails);
    expect(storedConnection).toMatchObject({
      id: "connection-live-1",
      status: "revoked",
      encryptedAccessToken: "",
      tokenIv: "",
      tokenAuthTag: "",
      tokenKid: "revoked",
      scopes: []
    });
    expect(storedConnection?.metadataJson).toMatchObject({
      label: "primary-meta",
      previousStatus: "connected",
      disconnectReason: "approval_executed"
    });
  });
});
