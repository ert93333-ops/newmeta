import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as getSettings, PATCH as patchSettings } from "@/app/api/settings/[...path]/route";
import { MemoryHermesRepository } from "@/lib/repositories/hermes-repository";
import type { UserContext } from "@/lib/types";

const { mockResolveUserContext } = vi.hoisted(() => ({
  mockResolveUserContext: vi.fn()
}));

vi.mock("@/lib/api/context", () => ({
  resolveUserContext: mockResolveUserContext
}));

function params(path: string[]) {
  return { params: Promise.resolve({ path }) };
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

const marketerContext: UserContext = {
  userId: "settings-marketer",
  tenantId: "tenant-settings-route",
  role: "marketer"
};

const ENV_KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] as const;
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const mutableEnv = process.env as unknown as Record<string, string | undefined>;

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

function clearSupabaseEnv(): void {
  for (const key of ENV_KEYS) {
    delete mutableEnv[key];
  }
}

describe("settings route", () => {
  afterEach(() => {
    mockResolveUserContext.mockReset();
    restoreEnv();
  });

  it("returns authentication failures from context resolution", async () => {
    clearSupabaseEnv();
    mockResolveUserContext.mockRejectedValue(new Error("SUPABASE_AUTH_REQUIRED"));

    const response = await patchSettings(
      new Request("http://localhost/api/settings/cost-guard", {
        method: "PATCH",
        body: JSON.stringify({
          providerName: "mock-ai",
          dailyCostCapKrw: 5000
        })
      }),
      params(["cost-guard"])
    );
    const body = await json(response);

    expect(response.status).toBe(401);
    expect((body.error as { code?: string }).code).toBe("SUPABASE_AUTH_REQUIRED");
  });

  it("hard-blocks budget settings paths even when the body is non-executable", async () => {
    clearSupabaseEnv();
    mockResolveUserContext.mockResolvedValue(marketerContext);

    const response = await patchSettings(
      new Request("http://localhost/api/settings/budget", {
        method: "PATCH",
        body: JSON.stringify({
          note: "Keep budget changes manual."
        })
      }),
      params(["budget"])
    );
    const body = await json(response);

    expect(response.status).toBe(403);
    expect((body.error as { code?: string }).code).toBe("BUDGET_MUTATION_HARD_BLOCKED");
  });

  it("hard-blocks budget settings reads", async () => {
    clearSupabaseEnv();
    mockResolveUserContext.mockResolvedValue(marketerContext);

    const response = await getSettings(new Request("http://localhost/api/settings/budget"), params(["budget"]));
    const body = await json(response);

    expect(response.status).toBe(403);
    expect((body.error as { code?: string }).code).toBe("BUDGET_MUTATION_HARD_BLOCKED");
  });

  it("returns tenant-scoped settings for viewer reads", async () => {
    clearSupabaseEnv();
    const provider = "cost-guard-read-route";
    const repository = new MemoryHermesRepository();
    await repository.saveIntegrationSettings(new Request("http://localhost/api/test"), {
      tenantId: marketerContext.tenantId,
      createdBy: marketerContext.userId,
      provider,
      settingsJson: {
        providerName: "mock-ai",
        dailyCostCapKrw: 5000
      }
    });
    mockResolveUserContext.mockResolvedValue({
      ...marketerContext,
      role: "viewer"
    } satisfies UserContext);

    const response = await getSettings(new Request(`http://localhost/api/settings/${provider}`), params([provider]));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      provider,
      configured: true,
      setting: {
        tenantId: marketerContext.tenantId,
        provider,
        settingsJson: {
          providerName: "mock-ai",
          dailyCostCapKrw: 5000
        }
      }
    });
  });

  it("returns configured false when no settings row exists", async () => {
    clearSupabaseEnv();
    mockResolveUserContext.mockResolvedValue(marketerContext);

    const response = await getSettings(new Request("http://localhost/api/settings/missing-provider"), params(["missing-provider"]));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({
      provider: "missing-provider",
      configured: false,
      setting: null
    });
  });

  it("rejects viewer settings writes", async () => {
    clearSupabaseEnv();
    mockResolveUserContext.mockResolvedValue({
      ...marketerContext,
      userId: "settings-viewer",
      role: "viewer"
    } satisfies UserContext);

    const response = await patchSettings(
      new Request("http://localhost/api/settings/cost-guard", {
        method: "PATCH",
        body: JSON.stringify({
          providerName: "mock-ai",
          dailyCostCapKrw: 5000
        })
      }),
      params(["cost-guard"])
    );
    const body = await json(response);

    expect(response.status).toBe(403);
    expect((body.error as { code?: string }).code).toBe("ROLE_ACCESS_DENIED");
  });

  it("persists tenant-scoped settings updates instead of returning an unauthenticated placeholder", async () => {
    clearSupabaseEnv();
    mockResolveUserContext.mockResolvedValue(marketerContext);
    const repository = new MemoryHermesRepository();
    const provider = "cost-guard-settings-route";

    const firstResponse = await patchSettings(
      new Request(`http://localhost/api/settings/${provider}`, {
        method: "PATCH",
        body: JSON.stringify({
          providerName: "mock-ai",
          dailyCostCapKrw: 5000
        })
      }),
      params([provider])
    );
    const firstBody = await json(firstResponse);
    const firstSetting = firstBody.setting as { id: string };

    const secondResponse = await patchSettings(
      new Request(`http://localhost/api/settings/${provider}`, {
        method: "PATCH",
        body: JSON.stringify({
          providerName: "mock-ai",
          dailyCostCapKrw: 3000
        })
      }),
      params([provider])
    );
    const secondBody = await json(secondResponse);
    const stored = await repository.getIntegrationSettings(
      new Request("http://localhost/api/test"),
      marketerContext,
      provider
    );

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(secondBody).toMatchObject({
      status: "saved",
      provider,
      setting: {
        id: firstSetting.id,
        tenantId: marketerContext.tenantId,
        provider,
        settingsJson: {
          providerName: "mock-ai",
          dailyCostCapKrw: 3000
        }
      }
    });
    expect(stored).toMatchObject({
      id: firstSetting.id,
      tenantId: marketerContext.tenantId,
      provider,
      settingsJson: {
        providerName: "mock-ai",
        dailyCostCapKrw: 3000
      }
    });
  });
});
