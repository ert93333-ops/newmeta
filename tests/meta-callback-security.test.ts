import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/integrations/meta/callback/route";
import { mockContext } from "@/lib/api/context";
import { createMetaOAuthState } from "@/lib/meta/oauth-state";

const callbackRouteSource = readFileSync(
  join(process.cwd(), "src", "app", "api", "integrations", "meta", "callback", "route.ts"),
  "utf8"
);

const ENV_KEYS = ["HERMES_AUTH_MODE", "HERMES_META_OAUTH_MODE", "TOKEN_ENCRYPTION_KEY"] as const;
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

describe("Meta OAuth callback response security", () => {
  beforeEach(() => {
    mutableEnv.HERMES_AUTH_MODE = "mock";
    mutableEnv.HERMES_META_OAUTH_MODE = "mock";
    mutableEnv.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  });

  afterEach(() => {
    restoreEnv();
  });

  it("does not return token-shaped fields to the client", () => {
    expect(callbackRouteSource).not.toMatch(/\b(access_token|refresh_token|client_secret)\b/i);
    expect(callbackRouteSource).not.toContain("token:");
    expect(callbackRouteSource).not.toContain('"token"');
  });

  it("does not serialize encrypted token material directly from the route", () => {
    expect(callbackRouteSource).not.toMatch(/\b(encryptedAccessToken|tokenIv|tokenAuthTag)\b/);
  });

  it("omits token-shaped fields from the actual callback response", async () => {
    const state = createMetaOAuthState(mockContext()).value;
    const response = await POST(
      new Request("http://localhost/api/integrations/meta/callback", {
        method: "POST",
        body: JSON.stringify({ code: "mock-code", state })
      })
    );
    const body = (await response.json()) as Record<string, unknown>;
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(201);
    expect(body).not.toHaveProperty("token");
    expect(serialized).not.toMatch(/\b(access_token|refresh_token|client_secret)\b/i);
    expect(serialized).toContain("encryptedTokenStored");
  });

  it("stores encrypted token material only in the server-side repository boundary", async () => {
    const state = createMetaOAuthState(mockContext()).value;
    const response = await POST(
      new Request("http://localhost/api/integrations/meta/callback", {
        method: "POST",
        body: JSON.stringify({ code: "mock-code-for-storage", state })
      })
    );
    const body = (await response.json()) as { connection?: { id?: string } };
    const store = globalThis as typeof globalThis & {
      __hermesRepositoryStore?: {
        metaConnections?: Map<string, Record<string, unknown>>;
      };
    };
    const stored = store.__hermesRepositoryStore?.metaConnections?.get(String(body.connection?.id));

    expect(response.status).toBe(201);
    expect(stored?.encryptedAccessToken).toEqual(expect.any(String));
    expect(stored?.tokenIv).toEqual(expect.any(String));
    expect(stored?.tokenAuthTag).toEqual(expect.any(String));
    expect(JSON.stringify(stored)).not.toContain("mock-code-for-storage");
  });

  it("requires Meta OAuth state before storing a connection", async () => {
    const response = await POST(
      new Request("http://localhost/api/integrations/meta/callback", {
        method: "POST",
        body: JSON.stringify({ code: "mock-code" })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("META_OAUTH_STATE_REQUIRED");
  });

  it("rejects direct access token payloads at the callback boundary", async () => {
    const response = await POST(
      new Request("http://localhost/api/integrations/meta/callback", {
        method: "POST",
        body: JSON.stringify({ access_token: "must-not-be-accepted" })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("CREDENTIAL_PAYLOAD_BLOCKED");
    expect(JSON.stringify(body)).not.toContain("must-not-be-accepted");
  });

  it("ignores client-supplied scopes and stores server-owned granted scopes instead", async () => {
    const state = createMetaOAuthState(mockContext()).value;
    const response = await POST(
      new Request("http://localhost/api/integrations/meta/callback", {
        method: "POST",
        body: JSON.stringify({ code: "mock-code", scopes: ["forged_scope"], state })
      })
    );
    const body = (await response.json()) as {
      connection?: {
        scopes?: string[];
      };
    };

    expect(response.status).toBe(201);
    expect(body.connection?.scopes).toEqual(
      expect.arrayContaining(["ads_read", "ads_management", "business_management"])
    );
    expect(body.connection?.scopes).not.toContain("forged_scope");
  });
});
