export interface ProductReferenceGenerationContext {
  sources?: {
    productImageUrl?: string;
    homepageUrl?: string;
    canonicalUrl?: string;
  };
  productFacts?: {
    title?: string;
    description?: string;
    brand?: string;
    name?: string;
    image?: string;
  };
  candidateImages?: string[];
  variantCount?: number;
  generationInstruction?: string;
  extractionPolicy?: {
    mode?: string;
    rawHtmlStored?: false;
    javascriptExecuted?: false;
    generatedClaimsAllowed?: false;
  };
}

export interface PaidGenerationContext {
  prompt?: string;
  variantCount?: number;
  productReference?: ProductReferenceGenerationContext;
  experimentPlan?: {
    mode: "controlled_ab_test";
    changedVariable: string;
    control: string;
    primaryMetric: string;
    secondaryMetrics: string[];
    minimumData: string;
    stopCondition: string;
    registrationMode: "paused_draft_after_qa";
  };
  draftRegistration?: {
    mode: "paused_draft_after_qa";
    requiresDraftApproval: true;
    route: "/api/drafts/create-paused";
  };
}

export function normalizePaidGenerationContext(value: unknown): PaidGenerationContext | undefined {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }
  const productReference = normalizeProductReference(record.productReference);
  const experimentPlan = normalizeExperimentPlan(record.experimentPlan);
  const context: PaidGenerationContext = {
    prompt: readString(record.prompt),
    variantCount: readPositiveInteger(record.variantCount),
    productReference,
    experimentPlan,
    draftRegistration: {
      mode: "paused_draft_after_qa",
      requiresDraftApproval: true,
      route: "/api/drafts/create-paused"
    }
  };
  return hasContextValue(context) ? context : undefined;
}

export function buildGenerationInputFromApproval(afterJson: unknown): PaidGenerationContext | undefined {
  const record = readRecord(afterJson);
  return normalizePaidGenerationContext(record?.generationContext);
}

function normalizeProductReference(value: unknown): ProductReferenceGenerationContext | undefined {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }
  const extractionPolicy = readRecord(record.extractionPolicy);
  const productReference: ProductReferenceGenerationContext = {
    sources: readStringRecord(record.sources),
    productFacts: readStringRecord(record.productFacts),
    candidateImages: readStringArray(record.candidateImages),
    variantCount: readPositiveInteger(record.variantCount),
    generationInstruction: readString(record.generationInstruction),
    extractionPolicy: extractionPolicy
      ? {
          mode: readString(extractionPolicy.mode),
          rawHtmlStored: extractionPolicy.rawHtmlStored === false ? false : undefined,
          javascriptExecuted: extractionPolicy.javascriptExecuted === false ? false : undefined,
          generatedClaimsAllowed: extractionPolicy.generatedClaimsAllowed === false ? false : undefined
        }
      : undefined
  };
  return Object.values(productReference).some(Boolean) ? productReference : undefined;
}

function normalizeExperimentPlan(value: unknown): PaidGenerationContext["experimentPlan"] | undefined {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }
  return {
    mode: "controlled_ab_test",
    changedVariable: readString(record.changedVariable) ?? "single creative angle",
    control: readString(record.control) ?? "current best-matching ad",
    primaryMetric: readString(record.primaryMetric) ?? "CTR",
    secondaryMetrics: readStringArray(record.secondaryMetrics) ?? ["CTR", "LPV rate", "ATC rate", "purchase rate"],
    minimumData: readString(record.minimumData) ?? "impressions >= 1,500, link_clicks >= 50, landing_page_views >= 30",
    stopCondition: readString(record.stopCondition) ?? "Do not call a winner before minimum signal.",
    registrationMode: "paused_draft_after_qa"
  };
}

function hasContextValue(context: PaidGenerationContext): boolean {
  return Boolean(context.prompt || context.variantCount || context.productReference || context.experimentPlan);
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 3000) : undefined;
}

function readPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return undefined;
  }
  return Math.min(value, 20);
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const strings = value
    .map(readString)
    .filter((item): item is string => Boolean(item));
  return strings.length > 0 ? strings.slice(0, 20) : undefined;
}

function readStringRecord(value: unknown): Record<string, string> | undefined {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }
  const entries = Object.entries(record).flatMap(([key, raw]) => {
    const stringValue = readString(raw);
    return stringValue ? [[key, stringValue] as const] : [];
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
