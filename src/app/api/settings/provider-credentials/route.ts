import { handleError, fail, ok, parseWriteJson } from "@/lib/api/responses";
import { getRepository } from "@/lib/repositories/hermes-repository";
import { resolveUserContext } from "@/lib/api/context";
import { assertRole } from "@/lib/security/rbac";
import { encryptToken } from "@/lib/security/token-crypto";

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Claude / Anthropic",
  higgsfield: "Higgsfield",
  generic_http: "Generic HTTPS Provider"
};

interface CredentialPayload {
  provider?: string;
  credentialValue?: string;
  endpointUrl?: string;
  label?: string;
}

export async function GET(request: Request) {
  try {
    const context = await resolveUserContext(request);
    const url = new URL(request.url);
    const provider = normalizeProvider(url.searchParams.get("provider"));
    if (!provider) {
      return fail("PROVIDER_REQUIRED", "Provider is required.", 400);
    }

    const setting = await getRepository().getIntegrationSettings(request, context, credentialProviderKey(provider));
    return ok({
      provider,
      label: PROVIDER_LABELS[provider] ?? provider,
      configured: Boolean(setting),
      endpointConfigured: Boolean(readSettings(setting?.settingsJson).endpointUrl),
      endpointUrl: readSettings(setting?.settingsJson).endpointUrl,
      updatedAt: setting?.updatedAt,
      keyPreview: readSettings(setting?.settingsJson).keyPreview
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveUserContext(request);
    assertRole(context, "admin");

    const body = (await parseWriteJson(request)) as CredentialPayload;

    const provider = normalizeProvider(body.provider);
    const credentialValue = body.credentialValue?.trim();
    if (!provider) {
      return fail("PROVIDER_REQUIRED", "Provider is required.", 400);
    }
    if (!credentialValue) {
      return fail("PROVIDER_CREDENTIAL_REQUIRED", "Provider credential is required.", 400);
    }

    const encryptionKey = process.env.TOKEN_ENCRYPTION_KEY?.trim();
    if (!encryptionKey) {
      return fail("TOKEN_ENCRYPTION_KEY_REQUIRED", "Token encryption key is required before storing provider credentials.", 501);
    }

    const encrypted = encryptToken(credentialValue, encryptionKey, "provider-credential");
    const repository = getRepository();
    const key = credentialProviderKey(provider);
    const existing = await repository.getIntegrationSettings(request, context, key);
    const setting = await repository.saveIntegrationSettings(request, {
      id: existing?.id,
      tenantId: context.tenantId,
      createdBy: existing?.createdBy ?? context.userId,
      provider: key,
      createdAt: existing?.createdAt,
      updatedAt: existing?.updatedAt,
      settingsJson: {
        provider,
        label: body.label?.trim() || PROVIDER_LABELS[provider] || provider,
        endpointUrl: sanitizeEndpoint(body.endpointUrl),
        keyPreview: previewCredential(credentialValue),
        encryptedAccessToken: encrypted.encryptedAccessToken,
        tokenIv: encrypted.tokenIv,
        tokenAuthTag: encrypted.tokenAuthTag,
        tokenKid: encrypted.tokenKid,
        storedAt: new Date().toISOString()
      }
    });

    await repository.saveAuditLog(request, {
      tenantId: context.tenantId,
      userId: context.userId,
      action: "provider_credential_saved",
      objectType: "integration_settings",
      objectId: setting.id,
      afterJson: {
        provider,
        label: PROVIDER_LABELS[provider] ?? provider,
        endpointConfigured: Boolean(sanitizeEndpoint(body.endpointUrl)),
        keyPreview: previewCredential(credentialValue)
      },
      result: "persisted"
    });

    return ok({
      provider,
      label: PROVIDER_LABELS[provider] ?? provider,
      configured: true,
      endpointConfigured: Boolean(sanitizeEndpoint(body.endpointUrl)),
      endpointUrl: sanitizeEndpoint(body.endpointUrl),
      updatedAt: setting.updatedAt,
      keyPreview: previewCredential(credentialValue)
    });
  } catch (error) {
    return handleError(error);
  }
}

function credentialProviderKey(provider: string): string {
  return `provider-credential:${provider}`;
}

function normalizeProvider(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

function previewCredential(value: string): string {
  if (value.length <= 8) {
    return "********";
  }
  return `${value.slice(0, 3)}...${value.slice(-4)}`;
}

function sanitizeEndpoint(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed;
}

function readSettings(value: unknown): { endpointUrl?: string; keyPreview?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const record = value as Record<string, unknown>;
  return {
    endpointUrl: typeof record.endpointUrl === "string" ? record.endpointUrl : undefined,
    keyPreview: typeof record.keyPreview === "string" ? record.keyPreview : undefined
  };
}
