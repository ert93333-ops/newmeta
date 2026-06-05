import { randomUUID } from "node:crypto";
import { isProductionRuntime } from "@/lib/api/context";
import { DEFAULT_META_GRANTED_SCOPES } from "@/lib/meta/oauth-scopes";
import type { HermesRepository, MetaConnectionInput } from "@/lib/repositories/hermes-repository";
import { encryptToken } from "@/lib/security/token-crypto";
import type { UserContext } from "@/lib/types";

interface MetaOAuthTokenResult {
  accessToken: string;
  expiresIn?: number;
  tokenType?: string;
}

interface MetaOAuthConnectInput {
  request: Request;
  context: UserContext;
  repository: HermesRepository;
  code: string;
}

type MetaOAuthMode = "mock" | "live";

export interface StoredMetaConnectionResult {
  id: string;
  tenantId: string;
  status: string;
  scopes: string[];
  expiresAt?: string;
  encryptedTokenStored: boolean;
  mode: MetaOAuthMode;
}

export async function connectMetaOAuth(input: MetaOAuthConnectInput): Promise<StoredMetaConnectionResult> {
  const mode = resolveMetaOAuthMode();
  const tokenResult =
    mode === "mock" ? mockMetaOAuthToken(input.code) : await exchangeMetaAuthorizationCode(input.code);
  const grantedScopes =
    mode === "mock" ? Array.from(DEFAULT_META_GRANTED_SCOPES) : await fetchMetaGrantedScopes(tokenResult.accessToken);
  const encryptionKey = readRequiredEnv("TOKEN_ENCRYPTION_KEY", "TOKEN_ENCRYPTION_KEY_REQUIRED");
  const encrypted = encryptToken(tokenResult.accessToken, encryptionKey, process.env.TOKEN_ENCRYPTION_KEY_ID ?? "primary");
  const expiresAt = tokenResult.expiresIn
    ? new Date(Date.now() + tokenResult.expiresIn * 1000).toISOString()
    : undefined;
  const connection: MetaConnectionInput = {
    id: randomUUID(),
    tenantId: input.context.tenantId,
    createdBy: input.context.userId,
    provider: "meta",
    connectionMode: "oauth",
    encryptedAccessToken: encrypted.encryptedAccessToken,
    tokenIv: encrypted.tokenIv,
    tokenAuthTag: encrypted.tokenAuthTag,
    tokenKid: encrypted.tokenKid,
    scopes: grantedScopes,
    expiresAt,
    status: "connected",
    metadataJson: {
      mode,
      tokenType: tokenResult.tokenType ?? "bearer"
    }
  };

  await input.repository.saveMetaConnection(input.request, connection);
  await input.repository.saveAuditLog(input.request, {
    tenantId: input.context.tenantId,
    userId: input.context.userId,
    action: "meta_oauth_connected",
    objectType: "meta_connection",
    objectId: connection.id,
    afterJson: {
      id: connection.id,
      mode,
      scopes: grantedScopes,
      expiresAt,
      encryptedTokenStored: true
    },
    result: "connected"
  });

  return {
    id: connection.id,
    tenantId: connection.tenantId,
    status: connection.status,
    scopes: connection.scopes,
    expiresAt: connection.expiresAt,
    encryptedTokenStored: true,
    mode
  };
}

export function resolveMetaOAuthMode(): MetaOAuthMode {
  const configured = process.env.HERMES_META_OAUTH_MODE?.trim();
  if (configured === "mock") {
    if (isProductionRuntime()) {
      throw new Error("MOCK_META_OAUTH_DISABLED_IN_PRODUCTION");
    }
    return "mock";
  }
  if (configured === "live") {
    return "live";
  }
  if (isProductionRuntime()) {
    throw new Error("META_OAUTH_LIVE_NOT_CONFIGURED");
  }
  return "mock";
}

export async function exchangeMetaAuthorizationCode(code: string): Promise<MetaOAuthTokenResult> {
  const appId = readRequiredEnv("META_APP_ID", "META_OAUTH_LIVE_NOT_CONFIGURED");
  const appSecret = readRequiredEnv("META_APP_SECRET", "META_OAUTH_LIVE_NOT_CONFIGURED");
  const redirectUri = readRequiredEnv("META_REDIRECT_URI", "META_OAUTH_LIVE_NOT_CONFIGURED");
  const graphVersion = process.env.META_GRAPH_VERSION ?? "v24.0";
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/oauth/access_token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    cache: "no-store",
    body: new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: redirectUri,
      code
    })
  });

  if (!response.ok) {
    throw new Error(`META_OAUTH_CODE_EXCHANGE_FAILED:${response.status}`);
  }

  const body = (await response.json()) as Record<string, unknown>;
  const accessToken = typeof body.access_token === "string" ? body.access_token : undefined;
  if (!accessToken) {
    throw new Error("META_OAUTH_TOKEN_MISSING");
  }

  return {
    accessToken,
    expiresIn: readNumber(body.expires_in),
    tokenType: typeof body.token_type === "string" ? body.token_type : undefined
  };
}

export async function fetchMetaGrantedScopes(accessToken: string): Promise<string[]> {
  const graphVersion = process.env.META_GRAPH_VERSION ?? "v24.0";
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/me/permissions`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${accessToken}`
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`META_OAUTH_PERMISSIONS_FETCH_FAILED:${response.status}`);
  }

  const body = (await response.json()) as { data?: Array<{ permission?: unknown; status?: unknown }> };
  const grantedScopes = Array.isArray(body.data)
    ? Array.from(
        new Set(
          body.data
            .filter(
              (entry): entry is { permission: string; status: string } =>
                typeof entry?.permission === "string" && typeof entry?.status === "string"
            )
            .filter((entry) => entry.status === "granted")
            .map((entry) => entry.permission.trim())
            .filter((permission) => permission.length > 0)
        )
      )
    : [];

  if (grantedScopes.length === 0) {
    throw new Error("META_OAUTH_SCOPES_UNAVAILABLE");
  }

  return grantedScopes;
}

function mockMetaOAuthToken(code: string): MetaOAuthTokenResult {
  return {
    accessToken: `mock-meta-token:${code}:${randomUUID()}`,
    expiresIn: 3600,
    tokenType: "bearer"
  };
}

function readRequiredEnv(key: string, errorCode: string): string {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(errorCode);
  }
  return value;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
