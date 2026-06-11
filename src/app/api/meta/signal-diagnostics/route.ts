import { fail, handleError, ok } from "@/lib/api/responses";
import { resolveUserContext } from "@/lib/api/context";
import { resolveMetaAdapter } from "@/lib/meta/resolve-meta-adapter";
import { getRepository } from "@/lib/repositories/hermes-repository";

export async function GET(request: Request) {
  try {
    const context = await resolveUserContext(request);
    const repository = getRepository();
    const resolved = await resolveMetaAdapter({
      request,
      context,
      repository
    });
    const url = new URL(request.url);
    const adAccountId = url.searchParams.get("adAccountId")?.trim() || (resolved.mode === "mock" ? "act_mock_001" : "");
    if (!adAccountId) {
      return fail("META_AD_ACCOUNT_REQUIRED", "Meta ad account id is required for live signal diagnostics.", 400);
    }
    const signalSettings = await repository.getIntegrationSettings(request, context, "signal-diagnostics");

    return ok({
      adAccountId,
      adapterMode: resolved.mode,
      diagnostics: applySignalSettings(await resolved.adapter.getSignalDiagnostics(adAccountId), signalSettings?.settingsJson)
    });
  } catch (error) {
    return handleError(error);
  }
}

function applySignalSettings(diagnostics: unknown, settings: unknown): unknown {
  const base = isRecord(diagnostics) ? { ...diagnostics } : { diagnostics };
  const signalSettings = isRecord(settings) ? settings : {};
  const capi = isRecord(signalSettings.capi) ? signalSettings.capi : {};
  const ga4 = isRecord(signalSettings.ga4) ? signalSettings.ga4 : {};

  return {
    ...base,
    capi: readCapiDiagnostics(capi),
    ga4: readGa4Diagnostics(ga4)
  };
}

function readCapiDiagnostics(settings: Record<string, unknown>) {
  const datasetId = readString(settings.datasetId);
  const eventsAccessConfigured = settings.eventsAccessConfigured === true;
  return {
    status: datasetId && eventsAccessConfigured ? "configured" : datasetId ? "partial" : "not_configured",
    datasetId,
    eventsAccessConfigured,
    missing: [
      ...(!datasetId ? ["capi.datasetId"] : []),
      ...(!eventsAccessConfigured ? ["capi.eventsAccessConfigured"] : [])
    ]
  };
}

function readGa4Diagnostics(settings: Record<string, unknown>) {
  const propertyId = readString(settings.propertyId);
  const measurementId = readString(settings.measurementId);
  const serviceAccountConfigured = settings.serviceAccountConfigured === true;
  return {
    status: (propertyId || measurementId) && serviceAccountConfigured ? "configured" : propertyId || measurementId ? "partial" : "not_configured",
    propertyId,
    measurementId,
    serviceAccountConfigured,
    missing: [
      ...(!propertyId && !measurementId ? ["ga4.propertyId_or_measurementId"] : []),
      ...(!serviceAccountConfigured ? ["ga4.serviceAccountConfigured"] : [])
    ]
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
