import { fail, handleError, ok, parseWriteJson } from "@/lib/api/responses";
import { resolveUserContext } from "@/lib/api/context";
import { getRepository } from "@/lib/repositories/hermes-repository";
import {
  buildProductReferenceExtraction,
  normalizeHttpUrl,
  type ProductReferenceExtraction,
  type ProductReferenceInput
} from "@/lib/product-references/extractor";

const MAX_HOMEPAGE_BYTES = 250_000;
const FETCH_TIMEOUT_MS = 5_000;

interface ProductReferenceRequest {
  productImageUrl?: unknown;
  homepageUrl?: unknown;
  variantCount?: unknown;
}

export async function POST(request: Request) {
  try {
    const context = await resolveUserContext(request);
    const body = (await parseWriteJson(request)) as ProductReferenceRequest;
    const parsed = parseProductReferenceRequest(body);
    if (!parsed.ok) {
      return fail(parsed.code, parsed.message, 400, parsed.details);
    }

    const html = parsed.value.homepageUrl ? await fetchHomepageHtml(parsed.value.homepageUrl) : undefined;
    const extraction = buildProductReferenceExtraction(parsed.value, html);

    await getRepository().saveAuditLog(request, {
      tenantId: context.tenantId,
      userId: context.userId,
      action: "product_reference_extracted",
      objectType: "product_reference",
      objectId: parsed.value.homepageUrl ?? parsed.value.productImageUrl ?? "manual-reference",
      afterJson: auditPayload(extraction),
      result: "extracted"
    });

    return ok({ extraction });
  } catch (error) {
    return handleError(error);
  }
}

function parseProductReferenceRequest(body: ProductReferenceRequest):
  | { ok: true; value: ProductReferenceInput }
  | { ok: false; code: string; message: string; details?: unknown } {
  if (!isRecord(body)) {
    return invalid("Product reference payload must be an object.");
  }
  const productImageUrl = normalizeHttpUrl(body.productImageUrl);
  const homepageUrl = normalizeHttpUrl(body.homepageUrl);
  if (body.productImageUrl !== undefined && body.productImageUrl !== "" && !productImageUrl) {
    return invalid("Reference product image URL must be http or https.", { field: "productImageUrl" });
  }
  if (body.homepageUrl !== undefined && body.homepageUrl !== "" && !homepageUrl) {
    return invalid("Product homepage URL must be http or https.", { field: "homepageUrl" });
  }
  if (!productImageUrl && !homepageUrl) {
    return invalid("At least one product image URL or product homepage URL is required.", {
      fields: ["productImageUrl", "homepageUrl"]
    });
  }
  return {
    ok: true,
    value: {
      productImageUrl,
      homepageUrl,
      variantCount: readVariantCount(body.variantCount)
    }
  };
}

async function fetchHomepageHtml(homepageUrl: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(homepageUrl, {
      headers: {
        accept: "text/html,application/xhtml+xml"
      },
      redirect: "follow",
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`PRODUCT_REFERENCE_FETCH_FAILED:${response.status}`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !contentType.toLowerCase().includes("text/html")) {
      throw new Error("PRODUCT_REFERENCE_CONTENT_TYPE_UNSUPPORTED");
    }
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (contentLength > MAX_HOMEPAGE_BYTES) {
      throw new Error("PRODUCT_REFERENCE_CONTENT_TOO_LARGE");
    }
    return await readLimitedText(response);
  } finally {
    clearTimeout(timeout);
  }
}

async function readLimitedText(response: Response): Promise<string> {
  const body = response.body;
  if (!body) {
    return "";
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      return text + decoder.decode();
    }
    bytes += value.byteLength;
    if (bytes > MAX_HOMEPAGE_BYTES) {
      throw new Error("PRODUCT_REFERENCE_CONTENT_TOO_LARGE");
    }
    text += decoder.decode(value, { stream: true });
  }
}

function auditPayload(extraction: ProductReferenceExtraction): Record<string, unknown> {
  return {
    sources: extraction.sources,
    productFacts: extraction.productFacts,
    candidateImages: extraction.candidateImages,
    variantCount: extraction.variantCount,
    extractionPolicy: extraction.extractionPolicy
  };
}

function readVariantCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 3;
  }
  return Math.min(6, Math.max(1, Math.round(value)));
}

function invalid(message: string, details?: unknown) {
  return {
    ok: false as const,
    code: "PRODUCT_REFERENCE_PAYLOAD_INVALID",
    message,
    details
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
