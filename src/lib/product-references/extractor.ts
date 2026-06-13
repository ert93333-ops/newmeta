export interface ProductReferenceInput {
  productImageUrl?: string;
  homepageUrl?: string;
  variantCount: number;
}

export interface ProductReferenceExtraction {
  sources: {
    productImageUrl?: string;
    homepageUrl?: string;
    canonicalUrl?: string;
  };
  productFacts: {
    title?: string;
    description?: string;
    brand?: string;
    name?: string;
    image?: string;
  };
  candidateImages: string[];
  variantCount: number;
  extractionPolicy: {
    mode: "product_only";
    rawHtmlStored: false;
    javascriptExecuted: false;
    generatedClaimsAllowed: false;
  };
  generationInstruction: string;
}

interface HtmlMetadata {
  title?: string;
  description?: string;
  canonicalUrl?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  jsonLdProduct?: {
    name?: string;
    brand?: string;
    description?: string;
    image?: string;
  };
}

export function buildProductReferenceExtraction(input: ProductReferenceInput, html?: string): ProductReferenceExtraction {
  const metadata = html && input.homepageUrl ? extractProductReferenceFromHtml(html, input.homepageUrl) : {};
  const title = firstPresent(metadata.jsonLdProduct?.name, metadata.ogTitle, metadata.title);
  const description = firstPresent(metadata.jsonLdProduct?.description, metadata.ogDescription, metadata.description);
  const productImageUrl = normalizeHttpUrl(input.productImageUrl);
  const homepageUrl = normalizeHttpUrl(input.homepageUrl);
  const canonicalUrl = normalizeHttpUrl(metadata.canonicalUrl);
  const metadataImage = normalizeHttpUrl(metadata.jsonLdProduct?.image) ?? normalizeHttpUrl(metadata.ogImage);
  const candidateImages = uniqueStrings([productImageUrl, metadataImage]);

  const sources = {
    productImageUrl,
    homepageUrl,
    canonicalUrl
  };
  const productFacts = {
    title,
    description,
    brand: cleanText(metadata.jsonLdProduct?.brand),
    name: cleanText(metadata.jsonLdProduct?.name),
    image: candidateImages[0]
  };

  return {
    sources,
    productFacts,
    candidateImages,
    variantCount: input.variantCount,
    extractionPolicy: {
      mode: "product_only",
      rawHtmlStored: false,
      javascriptExecuted: false,
      generatedClaimsAllowed: false
    },
    generationInstruction: buildGenerationInstruction({
      sources,
      productFacts,
      candidateImages,
      variantCount: input.variantCount
    })
  };
}

export function extractProductReferenceFromHtml(html: string, pageUrl: string): HtmlMetadata {
  const limitedHtml = html.slice(0, 250_000);
  const baseUrl = normalizeHttpUrl(pageUrl);
  const jsonLdProduct = extractJsonLdProduct(limitedHtml, baseUrl);
  return {
    title: cleanText(readTagText(limitedHtml, "title")),
    description: readMetaContent(limitedHtml, "name", "description"),
    canonicalUrl: resolveUrl(readLinkHref(limitedHtml, "canonical"), baseUrl),
    ogTitle: readMetaContent(limitedHtml, "property", "og:title"),
    ogDescription: readMetaContent(limitedHtml, "property", "og:description"),
    ogImage: resolveUrl(readMetaContent(limitedHtml, "property", "og:image"), baseUrl),
    jsonLdProduct
  };
}

export function normalizeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function buildGenerationInstruction(input: {
  sources: ProductReferenceExtraction["sources"];
  productFacts: ProductReferenceExtraction["productFacts"];
  candidateImages: string[];
  variantCount: number;
}): string {
  const sourceParts = [
    input.sources.productImageUrl ? `참고 상품 이미지: ${input.sources.productImageUrl}` : "",
    input.sources.homepageUrl ? `상품 홈페이지: ${input.sources.homepageUrl}` : "",
    input.sources.canonicalUrl ? `표준 상품 페이지: ${input.sources.canonicalUrl}` : ""
  ].filter(Boolean);
  const factParts = [
    input.productFacts.name ? `상품명: ${input.productFacts.name}` : "",
    input.productFacts.brand ? `브랜드: ${input.productFacts.brand}` : "",
    input.productFacts.title ? `페이지 제목: ${input.productFacts.title}` : "",
    input.productFacts.description ? `설명: ${input.productFacts.description}` : "",
    input.candidateImages.length > 0 ? `상품 이미지 후보: ${input.candidateImages.join(", ")}` : ""
  ].filter(Boolean);

  return [
    sourceParts.length > 0 ? `${sourceParts.join("; ")}를 사용합니다.` : "",
    factParts.length > 0 ? `확인된 상품 사실: ${factParts.join("; ")}.` : "",
    "상품만 주 피사체로 추출하고 관련 없는 페이지 배경, 배너, 인물, 리뷰, 내비게이션, 장식 이미지는 제외합니다.",
    "확인 가능한 상품 사실만 유지하고 할인, 보증, 배송, 재고, 후기, 의료/금융성 문구는 새로 만들지 않습니다.",
    `상품 정체성, 오퍼 사실, 타겟, 랜딩 URL, 캠페인 목적, 예산은 고정한 채 변형마다 소재 변수 하나만 바꿔 ${input.variantCount}개의 다양한 변형을 생성합니다.`
  ]
    .filter(Boolean)
    .join(" ");
}

function readTagText(html: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(html);
  return cleanText(match?.[1]);
}

function readMetaContent(html: string, attrName: "name" | "property", attrValue: string): string | undefined {
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of metaTags) {
    const currentValue = readAttribute(tag, attrName);
    if (currentValue?.toLowerCase() === attrValue.toLowerCase()) {
      return cleanText(readAttribute(tag, "content"));
    }
  }
  return undefined;
}

function readLinkHref(html: string, relValue: string): string | undefined {
  const linkTags = html.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of linkTags) {
    const rel = readAttribute(tag, "rel");
    if (rel?.toLowerCase().split(/\s+/).includes(relValue.toLowerCase())) {
      return cleanText(readAttribute(tag, "href"));
    }
  }
  return undefined;
}

function readAttribute(tag: string, attrName: string): string | undefined {
  const match = new RegExp(`${attrName}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(tag);
  return decodeHtmlEntities(match?.[2] ?? match?.[3] ?? match?.[4]);
}

function extractJsonLdProduct(html: string, baseUrl?: string): HtmlMetadata["jsonLdProduct"] {
  const scriptMatches = html.match(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) ?? [];
  for (const script of scriptMatches) {
    const body = script.replace(/^<script\b[^>]*>/i, "").replace(/<\/script>$/i, "").trim();
    const parsed = safeJsonParse(body);
    const product = findProductNode(parsed);
    if (product) {
      return {
        name: cleanText(readString(product.name)),
        brand: cleanText(readBrand(product.brand)),
        description: cleanText(readString(product.description)),
        image: resolveUrl(readImage(product.image), baseUrl)
      };
    }
  }
  return undefined;
}

function findProductNode(value: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findProductNode(item);
      if (found) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const typeValue = value["@type"];
  const typeList = Array.isArray(typeValue) ? typeValue : [typeValue];
  if (typeList.some((item) => typeof item === "string" && item.toLowerCase() === "product")) {
    return value;
  }
  return findProductNode(value["@graph"]);
}

function readBrand(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (isRecord(value)) {
    return readString(value.name);
  }
  return undefined;
}

function readImage(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(readImage).find(Boolean);
  }
  if (isRecord(value)) {
    return readString(value.url);
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function resolveUrl(value: unknown, baseUrl?: string): string | undefined {
  const direct = normalizeHttpUrl(value);
  if (direct || typeof value !== "string" || !baseUrl) {
    return direct;
  }
  try {
    return normalizeHttpUrl(new URL(value.trim(), baseUrl).toString());
  } catch {
    return undefined;
  }
}

function firstPresent(...values: Array<string | undefined>): string | undefined {
  return values.map(cleanText).find((value): value is string => Boolean(value));
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const text = decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
  return text.length > 0 ? text.slice(0, 500) : undefined;
}

function decodeHtmlEntities(value: string | undefined): string {
  if (!value) {
    return "";
  }
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, " ");
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
