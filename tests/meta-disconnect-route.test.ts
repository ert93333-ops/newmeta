import { afterEach, describe, expect, it } from "vitest";
import { DELETE as disconnectMetaConnection } from "@/app/api/integrations/meta/[id]/route";
import { MemoryHermesRepository } from "@/lib/repositories/hermes-repository";
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
const mockContext: UserContext = {
  userId: "00000000-0000-0000-0000-000000000010",
  tenantId,
  role: "owner"
};

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = ORIGINAL_ENV[key];
    if (value === undefined) {
      delete mutableEnv[key];
    } else {
      mutableEnv[key] = value;
    }
  }
}

function clearEnv(): void {
  for (const key of ENV_KEYS) {
    delete mutableEnv[key];
  }
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("Meta connection disconnect route", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("requires production authentication before creating a disconnect approval", async () => {
    clearEnv();
    mutableEnv.NODE_ENV = "production";

    const response = await disconnectMetaConnection(
      new Request("http://localhost/api/integrations/meta/connection-unauth", {
        method: "DELETE"
      }),
      params("connection-unauth")
    );
    const body = await json(response);

    expect(response.status).toBe(401);
    expect((body.error as { code?: string }).code).toBe("SUPABASE_AUTH_REQUIRED");
  });

  it("creates a destructive approval instead of immediately disconnecting Meta tokens", async () => {
    clearEnv();
    mutableEnv.HERMES_AUTH_MODE = "mock";

    const response = await disconnectMetaConnection(
      new Request("http://localhost/api/integrations/meta/connection-approval", {
        method: "DELETE"
      }),
      params("connection-approval")
    );
    const body = await json(response);
    const approval = body.approval as { id: string; action: string; status: string; riskLevel: string };
    const stored = await new MemoryHermesRepository().getApproval(
      new Request("http://localhost/api/test"),
      mockContext,
      approval.id
    );

    expect(response.status).toBe(202);
    expect(body).toMatchObject({
      id: "connection-approval",
      status: "approval_required",
      requiredAction: "meta_disconnect_connection",
      guard: {
        riskLevel: "destructive",
        requiresSecondApproval: true,
        typedConfirmationRequired: true,
        requiredText: "APPROVE meta_disconnect_connection"
      }
    });
    expect(approval).toMatchObject({
      action: "meta_disconnect_connection",
      status: "pending",
      riskLevel: "destructive"
    });
    expect(stored?.id).toBe(approval.id);
    expect(JSON.stringify(body)).not.toContain("encrypted_access_token");
  });

  it("hard-blocks budget mutation payloads on disconnect requests", async () => {
    clearEnv();
    mutableEnv.HERMES_AUTH_MODE = "mock";

    const response = await disconnectMetaConnection(
      new Request("http://localhost/api/integrations/meta/connection-budget", {
        method: "DELETE",
        body: JSON.stringify({ daily_budget: 50000 })
      }),
      params("connection-budget")
    );
    const body = await json(response);

    expect(response.status).toBe(403);
    expect((body.error as { code?: string }).code).toBe("BUDGET_MUTATION_HARD_BLOCKED");
  });
});
