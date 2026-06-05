import type { CostSettings, UserContext } from "@/lib/types";
import type { HermesRepository } from "@/lib/repositories/hermes-repository";

const NUMBER_KEYS = [
  "monthlyPlanPriceKrw",
  "monthlyCredits",
  "creditUnitCostKrw",
  "imageGenerationCreditCost",
  "videoGenerationCreditCost",
  "analysisCreditCost",
  "dailyCostCapKrw",
  "monthlyCostCapKrw",
  "hardDailyCapKrw",
  "referenceDailyAdBudgetKrw",
  "exchangeRate"
] as const;

export class CostProviderRequiredError extends Error {
  readonly code = "COST_PROVIDER_REQUIRED";

  constructor() {
    super("COST_PROVIDER_REQUIRED");
  }
}

export class CostSettingsNotConfiguredError extends Error {
  readonly code = "COST_SETTINGS_NOT_CONFIGURED";

  constructor(readonly providerName: string) {
    super("COST_SETTINGS_NOT_CONFIGURED");
  }
}

export class CostSettingsInvalidError extends Error {
  readonly code = "COST_SETTINGS_INVALID";

  constructor(readonly providerName: string) {
    super("COST_SETTINGS_INVALID");
  }
}

export function readCostProviderName(value: unknown): string {
  if (typeof value !== "string") {
    throw new CostProviderRequiredError();
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new CostProviderRequiredError();
  }
  return trimmed;
}

export async function loadServerCostSettings(
  request: Request,
  context: UserContext,
  repository: HermesRepository,
  providerName: string
): Promise<CostSettings> {
  const record = await repository.getIntegrationSettings(request, context, providerName);
  if (!record) {
    throw new CostSettingsNotConfiguredError(providerName);
  }
  return parseCostSettings(providerName, record.settingsJson);
}

export function parseCostSettings(providerName: string, value: unknown): CostSettings {
  if (!isRecord(value)) {
    throw new CostSettingsInvalidError(providerName);
  }

  const parsed: CostSettings = {
    providerName
  };

  const planName = readOptionalString(value.planName);
  if (planName !== undefined) {
    parsed.planName = planName;
  }

  for (const key of NUMBER_KEYS) {
    const numberValue = readOptionalNumber(value[key]);
    if (numberValue !== undefined) {
      parsed[key] = numberValue;
    }
  }

  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
