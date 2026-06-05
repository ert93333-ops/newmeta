import { isProductionRuntime } from "@/lib/api/context";
import { MetaGraphApiAdapter } from "@/lib/meta/graph-meta-adapter";
import type { MetaAdapter } from "@/lib/meta/meta-adapter";
import { MockMetaAdapter } from "@/lib/meta/mock-meta-adapter";
import { MetaRequiredScopesMissingError } from "@/lib/meta/oauth";
import { REQUIRED_META_OAUTH_SCOPES } from "@/lib/meta/oauth-scopes";
import type { HermesRepository, MetaConnectionRecord } from "@/lib/repositories/hermes-repository";
import { decryptToken } from "@/lib/security/token-crypto";
import type { UserContext } from "@/lib/types";

export interface ResolvedMetaAdapter {
  adapter: MetaAdapter;
  connectionId?: string;
  mode: "mock" | "live";
  source: "local_fallback" | "stored_connection";
}

interface ResolveMetaAdapterInput {
  request: Request;
  context: UserContext;
  repository: HermesRepository;
}

export async function resolveMetaAdapter(input: ResolveMetaAdapterInput): Promise<ResolvedMetaAdapter> {
  const connection = await input.repository.getLatestMetaConnection(input.request, input.context, "meta");
  if (!connection) {
    if (isProductionRuntime()) {
      throw new Error("META_CONNECTION_REQUIRED");
    }

    return {
      adapter: new MockMetaAdapter(),
      mode: "mock",
      source: "local_fallback"
    };
  }

  const mode = readStoredMode(connection);
  if (mode === "mock") {
    if (isProductionRuntime()) {
      throw new Error("MOCK_META_CONNECTION_DISABLED_IN_PRODUCTION");
    }

    return {
      adapter: new MockMetaAdapter(),
      connectionId: connection.id,
      mode,
      source: "stored_connection"
    };
  }

  assertConnectionNotExpired(connection);
  assertConnectionHasRequiredScopes(connection);
  const encryptionKey = process.env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!encryptionKey) {
    throw new Error("TOKEN_ENCRYPTION_KEY_REQUIRED");
  }

  const accessToken = decryptToken(connection, encryptionKey);
  return {
    adapter: new MetaGraphApiAdapter(accessToken),
    connectionId: connection.id,
    mode,
    source: "stored_connection"
  };
}

function readStoredMode(connection: MetaConnectionRecord): "mock" | "live" {
  const metadata = connection.metadataJson;
  if (metadata && typeof metadata === "object" && "mode" in metadata && metadata.mode === "mock") {
    return "mock";
  }
  return "live";
}

function assertConnectionNotExpired(connection: MetaConnectionRecord): void {
  if (!connection.expiresAt) {
    return;
  }

  const expiresAt = Date.parse(connection.expiresAt);
  if (!Number.isFinite(expiresAt)) {
    throw new Error("META_CONNECTION_EXPIRED");
  }

  if (expiresAt <= Date.now()) {
    throw new Error("META_CONNECTION_EXPIRED");
  }
}

function assertConnectionHasRequiredScopes(connection: MetaConnectionRecord): void {
  const grantedScopes = new Set(connection.scopes);
  const missingScopes = REQUIRED_META_OAUTH_SCOPES.filter((scope) => !grantedScopes.has(scope));
  if (missingScopes.length > 0) {
    throw new MetaRequiredScopesMissingError(missingScopes);
  }
}
