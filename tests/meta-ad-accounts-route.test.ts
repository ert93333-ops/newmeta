import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as getMetaAdAccounts } from "@/app/api/meta/ad-accounts/route";
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
  userId: "meta-route-user",
  tenantId: "tenant-meta-route",
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

describe("Meta ad accounts route", () => {
  afterEach(() => {
    mockResolveUserContext.mockReset();
    restoreEnv();
    vi.unstubAllGlobals();
  });

  it("falls back to the mock adapter locally when no stored Meta connection exists", async () => {
    delete mutableEnv.NODE_ENV;
    delete mutableEnv.VERCEL_ENV;
    delete mutableEnv.NEXT_PUBLIC_SUPABASE_URL;
    delete mutableEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    mockResolveUserContext.mockResolvedValue(context);

    const response = await getMetaAdAccounts(new Request("http://localhost/api/meta/ad-accounts"));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.adapterMode).toBe("mock");
    expect(body.adAccounts).toEqual([
      expect.objectContaining({
        id: "act_mock_001"
      })
    ]);
  });

  it("fails closed in production when no stored live Meta connection exists", async () => {
    mutableEnv.NODE_ENV = "production";
    delete mutableEnv.VERCEL_ENV;
    delete mutableEnv.NEXT_PUBLIC_SUPABASE_URL;
    delete mutableEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    mockResolveUserContext.mockResolvedValue(context);

    const response = await getMetaAdAccounts(new Request("http://localhost/api/meta/ad-accounts"));
    const body = await json(response);

    expect(response.status).toBe(409);
    expect((body.error as { code?: string }).code).toBe("META_CONNECTION_REQUIRED");
  });

  it("uses the stored live Meta connection server-side without exposing its token", async () => {
    delete mutableEnv.NODE_ENV;
    delete mutableEnv.VERCEL_ENV;
    delete mutableEnv.NEXT_PUBLIC_SUPABASE_URL;
    delete mutableEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    mutableEnv.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    mockResolveUserContext.mockResolvedValue(context);
    const encrypted = encryptToken("server-token", mutableEnv.TOKEN_ENCRYPTION_KEY, "primary");
    await new MemoryHermesRepository().saveMetaConnection(new Request("http://localhost/api/test"), {
      id: "meta-live-connection",
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
            id: "act_live_123",
            name: "Live Account",
            currency: "KRW",
            timezone_name: "Asia/Seoul"
          }
        ]
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await getMetaAdAccounts(new Request("http://localhost/api/meta/ad-accounts"));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.adapterMode).toBe("live");
    expect(body.adAccounts).toEqual([
      {
        id: "act_live_123",
        name: "Live Account",
        currency: "KRW",
        timezoneName: "Asia/Seoul"
      }
    ]);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toContain("https://graph.facebook.com/");
    expect(url.searchParams.has("access_token")).toBe(false);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer server-token");
    expect(JSON.stringify(body)).not.toContain("server-token");
  });

  it("fails closed when the stored live connection is missing required scopes", async () => {
    delete mutableEnv.NODE_ENV;
    delete mutableEnv.VERCEL_ENV;
    delete mutableEnv.NEXT_PUBLIC_SUPABASE_URL;
    delete mutableEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    mutableEnv.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    mockResolveUserContext.mockResolvedValue(context);
    const encrypted = encryptToken("server-token", mutableEnv.TOKEN_ENCRYPTION_KEY, "primary");
    await new MemoryHermesRepository().saveMetaConnection(new Request("http://localhost/api/test"), {
      id: "meta-live-connection-missing-scopes",
      tenantId: context.tenantId,
      createdBy: context.userId,
      provider: "meta",
      connectionMode: "oauth",
      encryptedAccessToken: encrypted.encryptedAccessToken,
      tokenIv: encrypted.tokenIv,
      tokenAuthTag: encrypted.tokenAuthTag,
      tokenKid: encrypted.tokenKid,
      scopes: ["ads_read"],
      status: "connected",
      metadataJson: {
        mode: "live"
      }
    });

    const response = await getMetaAdAccounts(new Request("http://localhost/api/meta/ad-accounts"));
    const body = await json(response);

    expect(response.status).toBe(403);
    expect((body.error as { code?: string; details?: { missingScopes?: string[] } }).code).toBe(
      "META_REQUIRED_SCOPES_MISSING"
    );
    expect((body.error as { details?: { missingScopes?: string[] } }).details?.missingScopes).toEqual([
      "ads_management",
      "business_management"
    ]);
  });
});
