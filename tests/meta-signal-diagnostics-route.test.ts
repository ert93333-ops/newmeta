import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as getSignalDiagnostics } from "@/app/api/meta/signal-diagnostics/route";
import { MemoryHermesRepository } from "@/lib/repositories/hermes-repository";
import { encryptToken } from "@/lib/security/token-crypto";
import type { UserContext } from "@/lib/types";

const { mockResolveUserContext } = vi.hoisted(() => ({
  mockResolveUserContext: vi.fn()
}));

vi.mock("@/lib/api/context", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/context")>("@/lib/api/context");
  return {
    ...actual,
    resolveUserContext: mockResolveUserContext
  };
});

const context: UserContext = {
  userId: "meta-signal-user",
  tenantId: "tenant-meta-signal",
  role: "marketer"
};

const ENV_KEYS = [
  "NODE_ENV",
  "VERCEL_ENV",
  "TOKEN_ENCRYPTION_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
] as const;
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

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("Meta signal diagnostics route", () => {
  afterEach(() => {
    mockResolveUserContext.mockReset();
    delete (globalThis as typeof globalThis & { __hermesRepositoryStore?: unknown }).__hermesRepositoryStore;
    restoreEnv();
    vi.unstubAllGlobals();
  });

  it("returns mock Pixel/CAPI/GA4 diagnostics locally", async () => {
    delete mutableEnv.NODE_ENV;
    delete mutableEnv.VERCEL_ENV;
    delete mutableEnv.NEXT_PUBLIC_SUPABASE_URL;
    delete mutableEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    mockResolveUserContext.mockResolvedValue(context);

    const response = await getSignalDiagnostics(new Request("http://localhost/api/meta/signal-diagnostics"));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      adAccountId: "act_mock_001",
      adapterMode: "mock",
      diagnostics: {
        adAccountId: "act_mock_001",
        pixel: "mock_ok",
        capi: {
          status: "not_configured",
          eventsAccessConfigured: false,
          missing: ["capi.datasetId", "capi.eventsAccessConfigured"]
        },
        ga4: {
          status: "not_configured",
          serviceAccountConfigured: false,
          missing: ["ga4.propertyId_or_measurementId", "ga4.serviceAccountConfigured"]
        }
      }
    });
  });

  it("requires an explicit ad account id for live diagnostics", async () => {
    mutableEnv.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64");
    delete mutableEnv.NEXT_PUBLIC_SUPABASE_URL;
    delete mutableEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    mockResolveUserContext.mockResolvedValue(context);
    const encrypted = encryptToken("server-token", mutableEnv.TOKEN_ENCRYPTION_KEY, "primary");
    await new MemoryHermesRepository().saveMetaConnection(new Request("http://localhost/api/test"), {
      id: "meta-live-signal-missing-id",
      tenantId: context.tenantId,
      createdBy: context.userId,
      provider: "meta",
      connectionMode: "oauth",
      encryptedAccessToken: encrypted.encryptedAccessToken,
      tokenIv: encrypted.tokenIv,
      tokenAuthTag: encrypted.tokenAuthTag,
      tokenKid: encrypted.tokenKid,
      scopes: ["ads_read", "ads_management", "business_management"],
      status: "connected",
      metadataJson: {
        mode: "live"
      }
    });

    const response = await getSignalDiagnostics(new Request("http://localhost/api/meta/signal-diagnostics"));
    const body = await json(response);

    expect(response.status).toBe(400);
    expect((body.error as { code?: string }).code).toBe("META_AD_ACCOUNT_REQUIRED");
  });

  it("overlays CAPI and GA4 readiness from tenant signal settings", async () => {
    delete mutableEnv.NODE_ENV;
    delete mutableEnv.VERCEL_ENV;
    delete mutableEnv.NEXT_PUBLIC_SUPABASE_URL;
    delete mutableEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    mockResolveUserContext.mockResolvedValue(context);
    await new MemoryHermesRepository().saveIntegrationSettings(new Request("http://localhost/api/test"), {
      tenantId: context.tenantId,
      createdBy: context.userId,
      provider: "signal-diagnostics",
      settingsJson: {
        capi: {
          datasetId: "dataset_123",
          eventsAccessConfigured: true
        },
        ga4: {
          propertyId: "properties/123",
          measurementId: "G-ABCDE12345",
          serviceAccountConfigured: false
        }
      }
    });

    const response = await getSignalDiagnostics(new Request("http://localhost/api/meta/signal-diagnostics"));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      diagnostics: {
        capi: {
          status: "configured",
          datasetId: "dataset_123",
          eventsAccessConfigured: true,
          missing: []
        },
        ga4: {
          status: "partial",
          propertyId: "properties/123",
          measurementId: "G-ABCDE12345",
          serviceAccountConfigured: false,
          missing: ["ga4.serviceAccountConfigured"]
        }
      }
    });
    expect(JSON.stringify(body)).not.toMatch(/token|secret|client_secret/i);
  });

  it("uses the stored live Meta connection without exposing its token", async () => {
    delete mutableEnv.NODE_ENV;
    delete mutableEnv.VERCEL_ENV;
    delete mutableEnv.NEXT_PUBLIC_SUPABASE_URL;
    delete mutableEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    mutableEnv.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 12).toString("base64");
    mockResolveUserContext.mockResolvedValue(context);
    const encrypted = encryptToken("server-token", mutableEnv.TOKEN_ENCRYPTION_KEY, "primary");
    await new MemoryHermesRepository().saveMetaConnection(new Request("http://localhost/api/test"), {
      id: "meta-live-signal",
      tenantId: context.tenantId,
      createdBy: context.userId,
      provider: "meta",
      connectionMode: "oauth",
      encryptedAccessToken: encrypted.encryptedAccessToken,
      tokenIv: encrypted.tokenIv,
      tokenAuthTag: encrypted.tokenAuthTag,
      tokenKid: encrypted.tokenKid,
      scopes: ["ads_read", "ads_management", "business_management"],
      status: "connected",
      metadataJson: {
        mode: "live"
      }
    });
    const fetchMock = vi.fn(async () =>
      Response.json({
        data: [
          {
            id: "pixel_1",
            name: "Main Pixel",
            last_fired_time: "2026-06-11T00:00:00+0000",
            creation_time: "2025-01-01T00:00:00+0000",
            is_unavailable: false
          }
        ]
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await getSignalDiagnostics(
      new Request("http://localhost/api/meta/signal-diagnostics?adAccountId=act_live_123")
    );
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      adAccountId: "act_live_123",
      adapterMode: "live",
      diagnostics: {
        adAccountId: "act_live_123",
        pixel: {
          status: "connected",
          pixels: [
            {
              id: "pixel_1",
              name: "Main Pixel",
              status: "active"
            }
          ]
        },
        capi: {
          status: "not_configured",
          eventsAccessConfigured: false
        },
        ga4: {
          status: "not_configured",
          serviceAccountConfigured: false
        }
      }
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toContain("act_live_123/adspixels");
    expect(url.searchParams.has("access_token")).toBe(false);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer server-token");
    expect(JSON.stringify(body)).not.toContain("server-token");
  });
});
