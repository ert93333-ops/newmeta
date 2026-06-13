import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as extractProductReferenceRoute } from "@/app/api/product-references/extract/route";

const ENV_KEYS = [
  "NODE_ENV",
  "VERCEL_ENV",
  "HERMES_AUTH_MODE",
  "HERMES_DEFAULT_TENANT_ID",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
] as const;

const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const mutableEnv = process.env as unknown as Record<string, string | undefined>;
const tenantId = "00000000-0000-0000-0000-000000000001";
const originalFetch = globalThis.fetch;

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = ORIGINAL_ENV[key];
    if (value === undefined) {
      delete mutableEnv[key];
    } else {
      mutableEnv[key] = value;
    }
  }
}

function clearEnv(): void {
  for (const key of ENV_KEYS) {
    delete mutableEnv[key];
  }
}

function setMockEnv(): void {
  clearEnv();
  mutableEnv.HERMES_AUTH_MODE = "mock";
  mutableEnv.HERMES_DEFAULT_TENANT_ID = tenantId;
}

function request(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/product-references/extract", {
    method: "POST",
    headers: {
      "x-tenant-id": tenantId
    },
    body: JSON.stringify(body)
  });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("product reference extraction route", () => {
  afterEach(() => {
    restoreEnv();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("requires production authentication before extracting product references", async () => {
    clearEnv();
    mutableEnv.NODE_ENV = "production";

    const response = await extractProductReferenceRoute(
      request({
        homepageUrl: "https://shop.example.com/product"
      })
    );
    const body = await json(response);

    expect(response.status).toBe(401);
    expect((body.error as { code?: string }).code).toBe("SUPABASE_AUTH_REQUIRED");
  });

  it("rejects non-http product reference URLs", async () => {
    setMockEnv();

    const response = await extractProductReferenceRoute(
      request({
        productImageUrl: "file:///secret.png",
        homepageUrl: "https://shop.example.com/product"
      })
    );
    const body = await json(response);

    expect(response.status).toBe(400);
    expect((body.error as { code?: string }).code).toBe("PRODUCT_REFERENCE_PAYLOAD_INVALID");
  });

  it("extracts homepage metadata without returning raw HTML", async () => {
    setMockEnv();
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        `<!doctype html>
        <title>Nova Bottle</title>
        <meta name="description" content="Cold drink bottle" />
        <meta property="og:image" content="https://cdn.example.com/nova.jpg" />`,
        {
          status: 200,
          headers: {
            "content-type": "text/html",
            "content-length": "210"
          }
        }
      );
    }) as typeof fetch;

    const response = await extractProductReferenceRoute(
      request({
        productImageUrl: "https://cdn.example.com/ref.png",
        homepageUrl: "https://shop.example.com/product",
        variantCount: 5
      })
    );
    const body = await json(response);
    const extraction = body.extraction as {
      sources?: Record<string, unknown>;
      productFacts?: Record<string, unknown>;
      candidateImages?: string[];
      extractionPolicy?: Record<string, unknown>;
      generationInstruction?: string;
      rawHtml?: string;
    };

    expect(response.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://shop.example.com/product",
      expect.objectContaining({
        redirect: "follow",
        headers: { accept: "text/html,application/xhtml+xml" }
      })
    );
    expect(extraction.productFacts).toMatchObject({
      title: "Nova Bottle",
      description: "Cold drink bottle"
    });
    expect(extraction.candidateImages).toEqual(["https://cdn.example.com/ref.png", "https://cdn.example.com/nova.jpg"]);
    expect(extraction.extractionPolicy).toMatchObject({
      rawHtmlStored: false,
      javascriptExecuted: false,
      generatedClaimsAllowed: false
    });
    expect(extraction.generationInstruction).toContain("상품만 주 피사체로 추출");
    expect(extraction.rawHtml).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("<title>");
  });

  it("extracts from oversized homepages by reading only the capped prefix", async () => {
    setMockEnv();
    const largeTail = "x".repeat(600_000);
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        `<!doctype html>
        <title>Large Product Page</title>
        <meta name="description" content="Metadata near the top should still be usable." />
        ${largeTail}`,
        {
          status: 200,
          headers: {
            "content-type": "text/html",
            "content-length": "700000"
          }
        }
      );
    }) as typeof fetch;

    const response = await extractProductReferenceRoute(
      request({
        homepageUrl: "https://shop.example.com/large-product"
      })
    );
    const body = await json(response);
    const extraction = body.extraction as {
      productFacts?: Record<string, unknown>;
      rawHtml?: string;
    };

    expect(response.status).toBe(200);
    expect(extraction.productFacts).toMatchObject({
      title: "Large Product Page",
      description: "Metadata near the top should still be usable."
    });
    expect(extraction.rawHtml).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(largeTail);
  });
});
