import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exchangeMetaAuthorizationCode, fetchMetaGrantedScopes, resolveMetaOAuthMode } from "@/lib/meta/oauth";

const ENV_KEYS = [
  "NODE_ENV",
  "VERCEL_ENV",
  "HERMES_META_OAUTH_MODE",
  "META_APP_ID",
  "META_APP_SECRET",
  "META_REDIRECT_URI",
  "META_GRAPH_VERSION",
  "TOKEN_ENCRYPTION_KEY"
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
  vi.unstubAllGlobals();
}

describe("Meta OAuth exchange", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("defaults to mock mode outside production", () => {
    delete mutableEnv.NODE_ENV;
    delete mutableEnv.VERCEL_ENV;
    delete mutableEnv.HERMES_META_OAUTH_MODE;

    expect(resolveMetaOAuthMode()).toBe("mock");
  });

  it("requires live mode in production", () => {
    mutableEnv.NODE_ENV = "production";
    mutableEnv.HERMES_META_OAUTH_MODE = "mock";

    expect(() => resolveMetaOAuthMode()).toThrow("MOCK_META_OAUTH_DISABLED_IN_PRODUCTION");
  });

  it("exchanges authorization codes with server-only form fields and no token URL params", async () => {
    mutableEnv.META_APP_ID = "123456789";
    mutableEnv.META_APP_SECRET = "server-app-secret";
    mutableEnv.META_REDIRECT_URI = "https://app.newmeta.test/api/integrations/meta/callback";
    mutableEnv.META_GRAPH_VERSION = "v24.0";
    mutableEnv.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    const fetchMock = vi.fn(async () =>
      Response.json({
        access_token: "live-meta-token",
        expires_in: 7200,
        token_type: "bearer"
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await exchangeMetaAuthorizationCode("oauth-code");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = init.body as URLSearchParams;

    expect(result).toEqual({
      accessToken: "live-meta-token",
      expiresIn: 7200,
      tokenType: "bearer"
    });
    expect(url).toBe("https://graph.facebook.com/v24.0/oauth/access_token");
    expect(new URL(url).search).toBe("");
    expect(init.method).toBe("POST");
    expect(body.get("client_secret")).toBe("server-app-secret");
    expect(body.get("code")).toBe("oauth-code");
  });

  it("redacts Meta exchange failures to status-only errors", async () => {
    mutableEnv.META_APP_ID = "123456789";
    mutableEnv.META_APP_SECRET = "server-app-secret";
    mutableEnv.META_REDIRECT_URI = "https://app.newmeta.test/api/integrations/meta/callback";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: "server-app-secret should not surface" } }), {
            status: 400
          })
      )
    );

    await expect(exchangeMetaAuthorizationCode("oauth-code")).rejects.toThrow("META_OAUTH_CODE_EXCHANGE_FAILED:400");
    await expect(exchangeMetaAuthorizationCode("oauth-code")).rejects.not.toThrow("server-app-secret");
  });

  it("resolves granted scopes from Meta server-side instead of trusting the browser payload", async () => {
    mutableEnv.META_GRAPH_VERSION = "v24.0";
    const fetchMock = vi.fn(async () =>
      Response.json({
        data: [
          { permission: "ads_read", status: "granted" },
          { permission: "ads_management", status: "granted" },
          { permission: "pages_show_list", status: "declined" },
          { permission: "ads_read", status: "granted" }
        ]
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const scopes = await fetchMetaGrantedScopes("live-meta-token");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];

    expect(scopes).toEqual(["ads_read", "ads_management"]);
    expect(url).toBe("https://graph.facebook.com/v24.0/me/permissions");
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual(
      expect.objectContaining({
        authorization: "Bearer live-meta-token"
      })
    );
  });

  it("fails closed when granted scopes cannot be loaded from Meta", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "nope" } }), { status: 400 })));

    await expect(fetchMetaGrantedScopes("live-meta-token")).rejects.toThrow("META_OAUTH_PERMISSIONS_FETCH_FAILED:400");
  });
});
