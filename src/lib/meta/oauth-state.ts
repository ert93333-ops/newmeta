import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { isProductionRuntime } from "@/lib/api/context";
import type { UserContext } from "@/lib/types";

const META_OAUTH_STATE_PURPOSE = "meta_oauth";
const META_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export interface MetaOAuthState {
  value: string;
  expiresAt: string;
}

export interface MetaOAuthStatePayload {
  purpose: typeof META_OAUTH_STATE_PURPOSE;
  tenantHash: string;
  userHash: string;
  nonce: string;
  expiresAt: string;
}

export function createMetaOAuthState(context: UserContext, now = new Date()): MetaOAuthState {
  const secret = readMetaOAuthStateSecret();
  const expiresAt = new Date(now.getTime() + META_OAUTH_STATE_TTL_MS).toISOString();
  const payload: MetaOAuthStatePayload = {
    purpose: META_OAUTH_STATE_PURPOSE,
    tenantHash: scopedHash(secret, "tenant", context.tenantId),
    userHash: scopedHash(secret, "user", context.userId),
    nonce: randomUUID(),
    expiresAt
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(encodedPayload, secret);

  return {
    value: `${encodedPayload}.${signature}`,
    expiresAt
  };
}

export function verifyMetaOAuthState(
  value: string,
  context: UserContext,
  now = new Date()
): MetaOAuthStatePayload {
  if (!value.trim()) {
    throw new Error("META_OAUTH_STATE_REQUIRED");
  }

  const [encodedPayload, signature, extra] = value.split(".");
  if (!encodedPayload || !signature || extra !== undefined) {
    throw new Error("META_OAUTH_STATE_INVALID");
  }

  const secret = readMetaOAuthStateSecret();
  const expectedSignature = sign(encodedPayload, secret);
  if (!constantTimeEqual(signature, expectedSignature)) {
    throw new Error("META_OAUTH_STATE_INVALID");
  }

  const payload = readPayload(encodedPayload);
  const expiresAt = Date.parse(payload.expiresAt);
  if (!Number.isFinite(expiresAt)) {
    throw new Error("META_OAUTH_STATE_INVALID");
  }
  if (expiresAt <= now.getTime()) {
    throw new Error("META_OAUTH_STATE_EXPIRED");
  }

  const tenantHash = scopedHash(secret, "tenant", context.tenantId);
  const userHash = scopedHash(secret, "user", context.userId);
  if (payload.tenantHash !== tenantHash || payload.userHash !== userHash) {
    throw new Error("META_OAUTH_STATE_TENANT_MISMATCH");
  }

  return payload;
}

function readMetaOAuthStateSecret(): string {
  const secret = process.env.HERMES_OAUTH_STATE_SECRET?.trim();
  if (secret) {
    return secret;
  }
  if (isProductionRuntime()) {
    throw new Error("META_OAUTH_STATE_SECRET_REQUIRED");
  }
  const localFallback = process.env.TOKEN_ENCRYPTION_KEY?.trim();
  if (localFallback) {
    return localFallback;
  }
  throw new Error("META_OAUTH_STATE_SECRET_REQUIRED");
}

function readPayload(encodedPayload: string): MetaOAuthStatePayload {
  try {
    const decoded = Buffer.from(encodedPayload, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as Partial<MetaOAuthStatePayload>;
    if (
      parsed.purpose !== META_OAUTH_STATE_PURPOSE ||
      typeof parsed.tenantHash !== "string" ||
      typeof parsed.userHash !== "string" ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.expiresAt !== "string"
    ) {
      throw new Error("invalid payload");
    }
    return parsed as MetaOAuthStatePayload;
  } catch {
    throw new Error("META_OAUTH_STATE_INVALID");
  }
}

function scopedHash(secret: string, scope: "tenant" | "user", value: string): string {
  return createHmac("sha256", secret).update(`${scope}:${value}`).digest("base64url");
}

function sign(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function constantTimeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}
