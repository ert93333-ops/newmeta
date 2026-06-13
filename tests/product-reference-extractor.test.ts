import { describe, expect, it } from "vitest";
import {
  buildProductReferenceExtraction,
  extractProductReferenceFromHtml,
  normalizeHttpUrl
} from "@/lib/product-references/extractor";

const productHtml = `
<!doctype html>
<html>
  <head>
    <title>Nova Bottle - Hydration Lab</title>
    <link rel="canonical" href="/products/nova-bottle" />
    <meta name="description" content="Insulated stainless bottle for cold drinks." />
    <meta property="og:title" content="Nova Bottle product page" />
    <meta property="og:description" content="Keeps drinks cold without condensation." />
    <meta property="og:image" content="/cdn/nova-og.jpg" />
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": "Nova Bottle",
        "brand": { "name": "Hydration Lab" },
        "description": "Double-wall stainless bottle.",
        "image": ["/cdn/nova-main.jpg"]
      }
    </script>
  </head>
  <body>
    <nav>Do not copy navigation</nav>
    <section>Reviews and banners should not become claims.</section>
  </body>
</html>`;

describe("product reference extractor", () => {
  it("extracts conservative product facts without raw page chrome", () => {
    const metadata = extractProductReferenceFromHtml(productHtml, "https://shop.example.com/products/nova");

    expect(metadata).toMatchObject({
      title: "Nova Bottle - Hydration Lab",
      description: "Insulated stainless bottle for cold drinks.",
      canonicalUrl: "https://shop.example.com/products/nova-bottle",
      ogImage: "https://shop.example.com/cdn/nova-og.jpg",
      jsonLdProduct: {
        name: "Nova Bottle",
        brand: "Hydration Lab",
        description: "Double-wall stainless bottle.",
        image: "https://shop.example.com/cdn/nova-main.jpg"
      }
    });
  });

  it("builds product-only generation instructions from image and homepage facts", () => {
    const extraction = buildProductReferenceExtraction(
      {
        productImageUrl: "https://cdn.example.com/ref.png",
        homepageUrl: "https://shop.example.com/products/nova",
        variantCount: 4
      },
      productHtml
    );

    expect(extraction.sources).toMatchObject({
      productImageUrl: "https://cdn.example.com/ref.png",
      homepageUrl: "https://shop.example.com/products/nova",
      canonicalUrl: "https://shop.example.com/products/nova-bottle"
    });
    expect(extraction.extractionPolicy).toMatchObject({
      mode: "product_only",
      rawHtmlStored: false,
      javascriptExecuted: false,
      generatedClaimsAllowed: false
    });
    expect(extraction.candidateImages).toEqual([
      "https://cdn.example.com/ref.png",
      "https://shop.example.com/cdn/nova-main.jpg"
    ]);
    expect(extraction.generationInstruction).toContain("확인된 상품 사실");
    expect(extraction.generationInstruction).toContain("상품만 주 피사체로 추출");
    expect(extraction.generationInstruction).toContain("4개의 다양한 변형");
    expect(extraction.generationInstruction).not.toContain("<nav>");
  });

  it("accepts only http and https URLs", () => {
    expect(normalizeHttpUrl("https://example.com/product")).toBe("https://example.com/product");
    expect(normalizeHttpUrl("javascript:alert(1)")).toBeUndefined();
    expect(normalizeHttpUrl("file:///etc/passwd")).toBeUndefined();
  });
});
