import { afterEach, describe, expect, it } from "vitest";
import { POST as placementValidationRoute } from "@/app/api/placement/validate/route";
import { MemoryHermesRepository } from "@/lib/repositories/hermes-repository";
import type { UserContext } from "@/lib/types";

const ENV_KEYS = [
  "NODE_ENV",
  "VERCEL_ENV",
  "HERMES_AUTH_MODE",
  "HERMES_DEFAULT_TENANT_ID",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
] as const;

const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const mutableEnv = process.env as unknown as Record<string, string | undefined>;
const tenantId = "00000000-0000-0000-0000-000000000001";
const mockUserId = "00000000-0000-0000-0000-000000000010";
const context: UserContext = {
  userId: mockUserId,
  tenantId,
  role: "marketer"
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

function setMockEnv(): void {
  clearEnv();
  mutableEnv.HERMES_AUTH_MODE = "mock";
  mutableEnv.HERMES_DEFAULT_TENANT_ID = tenantId;
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function request(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/placement/validate", {
    method: "POST",
    headers: {
      "x-tenant-id": tenantId
    },
    body: JSON.stringify(body)
  });
}

describe("placement validation route", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("requires production authentication before creating a placement validation report", async () => {
    clearEnv();
    mutableEnv.NODE_ENV = "production";

    const response = await placementValidationRoute(
      request({
        asset: { type: "image", width: 1080, height: 1350 },
        placements: ["facebook_feed"]
      })
    );
    const body = await json(response);

    expect(response.status).toBe(401);
    expect((body.error as { code?: string }).code).toBe("SUPABASE_AUTH_REQUIRED");
  });

  it("persists a tenant-scoped placement validation report instead of returning an ephemeral result only", async () => {
    setMockEnv();
    const repository = new MemoryHermesRepository();

    const response = await placementValidationRoute(
      request({
        assetId: "asset-1",
        asset: { type: "image", width: 1080, height: 1350 },
        placements: ["facebook_feed", "instagram_stories"]
      })
    );
    const body = await json(response);
    const stored = await repository.getPlacementValidationReport(request({}), context, String(body.id));

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      tenantId,
      createdBy: mockUserId,
      assetId: "asset-1",
      status: "requires_variant",
      error1487569Risk: true
    });
    expect(stored).toMatchObject({
      id: body.id,
      tenantId,
      createdBy: mockUserId,
      assetId: "asset-1",
      status: "requires_variant",
      error1487569Risk: true,
      placements: ["facebook_feed", "instagram_stories"]
    });
  });
});
