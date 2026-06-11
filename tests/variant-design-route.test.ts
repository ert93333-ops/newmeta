import { afterEach, describe, expect, it } from "vitest";
import { approveRequest, createApprovalRequest } from "@/lib/approval/approval-policy";
import { MemoryHermesRepository } from "@/lib/repositories/hermes-repository";
import { POST as designVariantsRoute } from "@/app/api/variants/design/route";
import type { UserContext } from "@/lib/types";

const ENV_KEYS = [
  "NODE_ENV",
  "VERCEL_ENV",
  "HERMES_AUTH_MODE",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
] as const;

const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const mutableEnv = process.env as unknown as Record<string, string | undefined>;
const tenantId = "00000000-0000-0000-0000-000000000001";

const requester: UserContext = {
  userId: "variant-requester",
  tenantId,
  role: "marketer"
};

const approver: UserContext = {
  userId: "variant-approver",
  tenantId,
  role: "owner"
};

const variantBody = {
  controlId: "creative-control-1",
  hypothesis: "Hook clarity improves click-through rate.",
  variable: "hook" as const
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

function variantRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/variants/design", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

function approvedPaidVariantApproval() {
  return approveRequest(
    createApprovalRequest({
      context: requester,
      action: "ai_paid_generation",
      objectType: "variant_batch",
      objectId: variantBody.controlId,
      afterJson: {
        operationType: "variant_batch",
        controlId: variantBody.controlId
      }
    }),
    approver
  );
}

function approvedWrongObjectApproval() {
  return approveRequest(
    createApprovalRequest({
      context: requester,
      action: "ai_paid_generation",
      objectType: "image_generation",
      objectId: "image-job-1",
      afterJson: {
        operationType: "image_generation"
      }
    }),
    approver
  );
}

describe("variant design route paid operation guard", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("requires an approval request before designing a paid variant batch", async () => {
    clearEnv();
    setEnv("HERMES_AUTH_MODE", "mock");

    const response = await designVariantsRoute(variantRequest(variantBody));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("PAID_OPERATION_APPROVAL_REQUIRED");
    expect(body.error.details.operationType).toBe("variant_batch");
  });

  it("fails closed for paid variant batch execution in production until a real provider is configured", async () => {
    clearEnv();
    setEnv("NODE_ENV", "production");

    const response = await designVariantsRoute(
      variantRequest({
        ...variantBody,
        approvalRequestId: "approval-would-not-be-consumed"
      })
    );
    const body = await response.json();

    expect(response.status).toBe(501);
    expect(body.error.code).toBe("PAID_VARIANT_DESIGN_NOT_CONFIGURED");
  });

  it("rejects an approval that is not scoped to variant batches", async () => {
    clearEnv();
    setEnv("HERMES_AUTH_MODE", "mock");
    const repository = new MemoryHermesRepository();
    const approval = approvedWrongObjectApproval();
    await repository.saveApproval(variantRequest({}), approval);

    const response = await designVariantsRoute(
      variantRequest({
        ...variantBody,
        approvalRequestId: approval.id
      })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("PAID_OPERATION_APPROVAL_REQUIRED");
  });

  it("designs variants only after approval and then consumes that approval", async () => {
    clearEnv();
    setEnv("HERMES_AUTH_MODE", "mock");
    const repository = new MemoryHermesRepository();
    const approval = approvedPaidVariantApproval();
    await repository.saveApproval(variantRequest({}), approval);

    const response = await designVariantsRoute(
      variantRequest({
        ...variantBody,
        approvalRequestId: approval.id
      })
    );
    const body = await response.json();
    const stored = await repository.getApproval(variantRequest({}), approver, approval.id);

    expect(response.status).toBe(201);
    expect(body.control).toBe(variantBody.controlId);
    expect(body.approval).toMatchObject({
      id: approval.id,
      status: "executed",
      executionResultJson: {
        operation: "ai_paid_generation",
        operationType: "variant_batch",
        result: "variant_design_created"
      }
    });
    expect(stored?.status).toBe("executed");
  });

  it("does not allow the same paid generation approval to be reused", async () => {
    clearEnv();
    setEnv("HERMES_AUTH_MODE", "mock");
    const repository = new MemoryHermesRepository();
    const approval = approvedPaidVariantApproval();
    await repository.saveApproval(variantRequest({}), approval);

    await designVariantsRoute(
      variantRequest({
        ...variantBody,
        approvalRequestId: approval.id
      })
    );
    const secondResponse = await designVariantsRoute(
      variantRequest({
        ...variantBody,
        approvalRequestId: approval.id
      })
    );
    const secondBody = await secondResponse.json();

    expect(secondResponse.status).toBe(403);
    expect(secondBody.error.code).toBe("APPROVAL_REQUIRED");
  });
});
