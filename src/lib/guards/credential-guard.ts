const BLOCKED_CREDENTIAL_KEYS = new Set([
  "access_token",
  "accesstoken",
  "refresh_token",
  "refreshtoken",
  "client_secret",
  "clientsecret",
  "app_secret",
  "appsecret",
  "encrypted_access_token",
  "encryptedaccesstoken",
  "encrypted_refresh_token",
  "encryptedrefreshtoken",
  "encrypted_token",
  "encryptedtoken",
  "service_role",
  "servicerole",
  "service_role_key",
  "servicerolekey",
  "token_auth_tag",
  "tokenauthtag",
  "token_iv",
  "tokeniv",
  "token_kid",
  "tokenkid",
  "authorization",
  "bearer_token",
  "bearertoken",
  "token"
]);

export const CREDENTIAL_REDACTION = "[REDACTED_CREDENTIAL_FIELD]";

export class CredentialPayloadBlockedError extends Error {
  readonly code = "CREDENTIAL_PAYLOAD_BLOCKED";
  readonly paths: string[];

  constructor(paths: string[]) {
    super("Credential-shaped fields are not accepted in API payloads.");
    this.name = "CredentialPayloadBlockedError";
    this.paths = paths;
  }
}

export function findCredentialPayloadPaths(value: unknown, root = "$"): string[] {
  const paths: string[] = [];

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      paths.push(...findCredentialPayloadPaths(item, `${root}[${index}]`));
    });
    return paths;
  }

  if (!value || typeof value !== "object") {
    return paths;
  }

  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    const currentPath = `${root}.${key}`;
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");

    if (BLOCKED_CREDENTIAL_KEYS.has(key.toLowerCase()) || BLOCKED_CREDENTIAL_KEYS.has(normalizedKey)) {
      paths.push(currentPath);
    }

    paths.push(...findCredentialPayloadPaths(nestedValue, currentPath));
  }

  return paths;
}

export function assertNoCredentialPayload(value: unknown): void {
  const paths = findCredentialPayloadPaths(value);
  if (paths.length > 0) {
    throw new CredentialPayloadBlockedError(paths);
  }
}

export function redactCredentialPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactCredentialPayload(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (BLOCKED_CREDENTIAL_KEYS.has(key.toLowerCase()) || BLOCKED_CREDENTIAL_KEYS.has(normalizedKey)) {
        return [key, CREDENTIAL_REDACTION];
      }
      return [key, redactCredentialPayload(nestedValue)];
    })
  );
}

export function isCredentialPayloadBlockedError(error: unknown): error is CredentialPayloadBlockedError {
  return error instanceof CredentialPayloadBlockedError;
}
