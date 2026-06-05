import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMetaOAuthState, verifyMetaOAuthState } from "@/lib/meta/oauth-state";
import type { UserContext } from "@/lib/types";

const ENV_KEYS = ["NODE_ENV", "VERCEL_ENV", "TOKEN_ENCRYPTION_KEY", "HERMES_OAUTH_STATE_SECRET"] as const;
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const mutableEnv = process.env as unknown as Record<string, string | undefined>;

const CONTEXT: UserContext = {
  userId: "00000000-0000-0000-0000-000000000010",
  tenantId: "00000000-0000-0000-0000-000000000001",
  role: "owner",
  email: "owner@example.com"
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

function decodePayload(state: string): Record<string, unknown> {
  const [encodedPayload] = state.split(".");
  return JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Record<string, unknown>;
}

function encodePayload(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

describe("Meta OAuth signed state", () => {
  beforeEach(() => {
    delete mutableEnv.NODE_ENV;
    delete mutableEnv.VERCEL_ENV;
    mutableEnv.HERMES_OAUTH_STATE_SECRET = randomBytes(32).toString("hex");
    delete mutableEnv.TOKEN_ENCRYPTION_KEY;
  });

  afterEach(() => {
    restoreEnv();
  });

  it("creates a signed expiring state without exposing raw tenant or user ids", () => {
    const now = new Date("2026-06-05T00:00:00.000Z");
    const state = createMetaOAuthState(CONTEXT, now);
    const payload = verifyMetaOAuthState(state.value, CONTEXT, new Date("2026-06-05T00:05:00.000Z"));
    const serializedPayload = JSON.stringify(decodePayload(state.value));

    expect(payload.purpose).toBe("meta_oauth");
    expect(payload.expiresAt).toBe("2026-06-05T00:10:00.000Z");
    expect(serializedPayload).not.toContain(CONTEXT.tenantId);
    expect(serializedPayload).not.toContain(CONTEXT.userId);
  });

  it("rejects tampered state payloads", () => {
    const state = createMetaOAuthState(CONTEXT);
    const [encodedPayload, signature] = state.value.split(".");
    const payload = decodePayload(state.value);
    const tamperedState = `${encodePayload({ ...payload, nonce: "changed" })}.${signature}`;

    expect(encodedPayload).toBeTruthy();
    expect(() => verifyMetaOAuthState(tamperedState, CONTEXT)).toThrow("META_OAUTH_STATE_INVALID");
  });

  it("rejects expired state", () => {
    const state = createMetaOAuthState(CONTEXT, new Date("2026-06-05T00:00:00.000Z"));

    expect(() => verifyMetaOAuthState(state.value, CONTEXT, new Date("2026-06-05T00:10:00.001Z"))).toThrow(
      "META_OAUTH_STATE_EXPIRED"
    );
  });

  it("rejects state created for a different tenant or user", () => {
    const state = createMetaOAuthState(CONTEXT);
    const otherContext: UserContext = {
      ...CONTEXT,
      tenantId: "00000000-0000-0000-0000-000000000002"
    };

    expect(() => verifyMetaOAuthState(state.value, otherContext)).toThrow("META_OAUTH_STATE_TENANT_MISMATCH");
  });

  it("requires an explicit state secret in production", () => {
    delete mutableEnv.HERMES_OAUTH_STATE_SECRET;
    delete mutableEnv.TOKEN_ENCRYPTION_KEY;
    mutableEnv.NODE_ENV = "production";

    expect(() => createMetaOAuthState(CONTEXT)).toThrow("META_OAUTH_STATE_SECRET_REQUIRED");
  });
});
