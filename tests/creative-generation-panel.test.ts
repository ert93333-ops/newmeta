import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const panelSource = readFileSync(join(process.cwd(), "src", "app", "creative-generation-panel.tsx"), "utf8");
const pageSource = readFileSync(join(process.cwd(), "src", "app", "page.tsx"), "utf8");

describe("Creative generation panel", () => {
  it("is visible from the main app navigation", () => {
    expect(pageSource).toContain("CreativeGenerationPanel");
    expect(pageSource).toContain('href: "creative-generation"');
    expect(pageSource).toContain('label: "승인 센터"');
    expect(pageSource.indexOf("<CreativeGenerationPanel />")).toBeLessThan(pageSource.indexOf("<ApprovalCenterPanel />"));
    expect(pageSource.indexOf("<ApprovalCenterPanel />")).toBeLessThan(pageSource.indexOf("<SettingsPanel />"));
  });

  it("creates paid generation approval requests through the cost guard", () => {
    expect(panelSource).toContain("/api/cost/estimate");
    expect(panelSource).toContain("/api/dashboard/summary");
    expect(panelSource).toContain("approvalRequest");
    expect(panelSource).toContain("generationContext");
    expect(panelSource).toContain("buildGenerationContext");
    expect(panelSource).toContain("approvalReason");
    expect(panelSource).toContain("requestPrompt");
    expect(panelSource).toContain("hermes:approval-created");
    expect(panelSource).toContain('window.location.hash = "approval-center"');
    expect(panelSource).toContain('document.getElementById("approval-center")?.scrollIntoView');
    expect(panelSource).toContain("image_generation");
    expect(panelSource).toContain("video_generation");
    expect(panelSource).toContain('"x-tenant-id"');
    expect(panelSource).toContain("headers.authorization");
  });

  it("shows existing creative performance rationale before approval", () => {
    expect(panelSource).toContain("추천 기반 소재 방향");
    expect(panelSource).toContain("가장 좋은 신호");
    expect(panelSource).toContain("유지할 요소");
    expect(panelSource).toContain("개선할 요소");
    expect(panelSource).toContain("생성 방향");
    expect(panelSource).toContain("buildCreativeRationale");
  });

  it("can request generation from the recommended brief without a separate prompt", () => {
    expect(panelSource).toContain("추천 프롬프트");
    expect(panelSource).toContain("상품 추출");
    expect(panelSource).toContain("등록 흐름");
    expect(panelSource).toContain("A/B 테스트");
    expect(panelSource).toContain("자동화 경계");
    expect(panelSource).toContain("추천안으로 승인 요청");
    expect(panelSource).toContain("placeholder={rationale.recommendedPrompt}");
    expect(panelSource).toContain("prompt.trim() || rationale.recommendedPrompt");
    expect(panelSource).toContain("등록 메커니즘");
    expect(panelSource).toContain("A/B 테스트 계획");
  });

  it("accepts product reference inputs for product-only multi-variant generation", () => {
    expect(panelSource).toContain("참고 상품 이미지 URL");
    expect(panelSource).toContain("상품 홈페이지 URL");
    expect(panelSource).toContain("/api/product-references/extract");
    expect(panelSource).toContain("상품 정보 추출");
    expect(panelSource).toContain("productExtraction");
    expect(panelSource).toContain("ProductReferenceExtraction");
    expect(panelSource).toContain("buildProductReference");
    expect(panelSource).toContain("상품만 주 피사체로 추출");
    expect(panelSource).toContain("${variantCount}개의 다양한 변형");
    expect(panelSource).toContain("extraction.generationInstruction");
    expect(panelSource).toContain("draftRegistration");
    expect(panelSource).toContain("controlled_ab_test");
    expect(panelSource).toContain("units: variantCount");
    expect(panelSource).toContain("readVariantCount");
    expect(panelSource).toContain("normalizeOptionalUrl");
  });

  it("does not directly execute generation, Meta writes, or budget mutations", () => {
    expect(panelSource).not.toContain("/api/render/jobs");
    expect(panelSource).not.toContain("/api/meta/");
    expect(panelSource).not.toMatch(/daily_budget|lifetime_budget|BUDGET_MUTATION/);
    expect(panelSource).not.toContain("console.");
  });
});
