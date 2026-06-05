export interface LiveMetaAdSetValidationInput {
  objective: string;
  optimizationGoal: string;
  targeting: Record<string, unknown>;
  promotedObject?: Record<string, unknown>;
}

export function assertLiveMetaAdSetInput(input: LiveMetaAdSetValidationInput): void {
  if (!hasObjectKeys(input.targeting)) {
    throw new Error("META_TARGETING_REQUIRED");
  }

  const objective = normalizeEnum(input.objective);
  const optimizationGoal = normalizeEnum(input.optimizationGoal);
  const promotedObject = input.promotedObject;

  if (optimizationGoal === "OFFSITE_CONVERSIONS") {
    if (!promotedObject) {
      throw new Error("META_PROMOTED_OBJECT_REQUIRED");
    }
    if (!hasScalarValue(promotedObject.pixel_id)) {
      throw new Error("META_PIXEL_ID_REQUIRED");
    }
    if (
      !hasScalarValue(promotedObject.custom_event_type) &&
      !hasScalarValue(promotedObject.custom_event_str) &&
      !hasScalarValue(promotedObject.offsite_conversion_event_id) &&
      !hasScalarValue(promotedObject.conversion_goal_id)
    ) {
      throw new Error("META_CONVERSION_EVENT_REQUIRED");
    }
  }

  if (objective === "PRODUCT_CATALOG_SALES") {
    if (!promotedObject || !hasScalarValue(promotedObject.product_catalog_id)) {
      throw new Error("META_PRODUCT_CATALOG_REQUIRED");
    }
  }

  if (objective === "APP_INSTALLS" || objective === "OUTCOME_APP_PROMOTION") {
    if (!promotedObject || !hasScalarValue(promotedObject.application_id)) {
      throw new Error("META_APPLICATION_ID_REQUIRED");
    }
    if (!hasNonEmptyString(promotedObject.object_store_url)) {
      throw new Error("META_OBJECT_STORE_URL_REQUIRED");
    }
  }
}

function hasObjectKeys(value: Record<string, unknown>): boolean {
  return Object.keys(value).length > 0;
}

function normalizeEnum(value: string): string {
  return value.trim().toUpperCase();
}

function hasScalarValue(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return typeof value === "number" && Number.isFinite(value);
}

function hasNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
