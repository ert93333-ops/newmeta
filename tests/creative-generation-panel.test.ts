import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const panelSource = readFileSync(join(process.cwd(), "src", "app", "creative-generation-panel.tsx"), "utf8");
const pageSource = readFileSync(join(process.cwd(), "src", "app", "page.tsx"), "utf8");

describe("Creative generation panel", () => {
  it("is visible from the main app navigation", () => {
    expect(pageSource).toContain("CreativeGenerationPanel");
    expect(pageSource).toContain('href: "creative-generation"');
    expect(pageSource).toContain('label: "소재 생성"');
  });

  it("creates paid generation approval requests through the cost guard", () => {
    expect(panelSource).toContain("/api/cost/estimate");
    expect(panelSource).toContain("/api/dashboard/summary");
    expect(panelSource).toContain("approvalRequest");
    expect(panelSource).toContain("approvalReason");
    expect(panelSource).toContain("hermes:approval-created");
    expect(panelSource).toContain('window.location.hash = "approval-center"');
    expect(panelSource).toContain('document.getElementById("approval-center")?.scrollIntoView');
    expect(panelSource).toContain("image_generation");
    expect(panelSource).toContain("video_generation");
    expect(panelSource).toContain('"x-tenant-id"');
    expect(panelSource).toContain("headers.authorization");
  });

  it("shows existing creative performance rationale before approval", () => {
    expect(panelSource).toContain("기존 소재 분석 기반 생성 방향");
    expect(panelSource).toContain("성과가 좋았던 소재");
    expect(panelSource).toContain("좋았던 부분");
    expect(panelSource).toContain("나빴던 부분");
    expect(panelSource).toContain("생성할 소재 방향");
    expect(panelSource).toContain("buildCreativeRationale");
  });

  it("does not directly execute generation, Meta writes, or budget mutations", () => {
    expect(panelSource).not.toContain("/api/render/jobs");
    expect(panelSource).not.toContain("/api/meta/");
    expect(panelSource).not.toMatch(/daily_budget|lifetime_budget|BUDGET_MUTATION/);
    expect(panelSource).not.toContain("console.");
  });
});
