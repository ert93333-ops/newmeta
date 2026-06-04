const BLOCKED_CREDENTIAL_KEYS = new Set([
  "access_token",
  "accesstoken",
  "refresh_token",
  "refreshtoken",
  "client_secret",
  "clientsecret",
  "app_secret",
  "appsecret",
  "service_role",
  "servicerole",
  "service_role_key",
  "servicerolekey",
  "authorization",
  "bearer_token",
  "bearertoken",
  "token"
]);

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

export function isCredentialPayloadBlockedError(error: unknown): error is CredentialPayloadBlockedError {
  return error instanceof CredentialPayloadBlockedError;
}
