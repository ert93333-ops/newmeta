import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const panelSource = readFileSync(join(process.cwd(), "src", "app", "settings-panel.tsx"), "utf8");
const pageSource = readFileSync(join(process.cwd(), "src", "app", "page.tsx"), "utf8");

describe("Settings panel", () => {
  it("loads and saves tenant-scoped operation, cost, and credential settings through server routes", () => {
    expect(panelSource).toContain('method: "PATCH"');
    expect(panelSource).toContain('method: "POST"');
    expect(panelSource).toContain("/api/settings/ai-ops-permissions");
    expect(panelSource).toContain("/api/settings/provider-credentials");
    expect(panelSource).toContain("/api/settings/${encodeURIComponent(cost.providerName)}");
    expect(panelSource).toContain('"x-tenant-id"');
    expect(panelSource).toContain("headers.authorization");
    expect(panelSource).toContain("createSupabaseBrowserClient");
  });

  it("keeps write access role-gated and server-owned", () => {
    expect(panelSource).toContain("ROLE_RANK.marketer");
    expect(panelSource).toContain("ROLE_RANK.admin");
    expect(panelSource).toContain("toPolicyPayload");
    expect(panelSource).toContain("toCostPayload");
    expect(panelSource).toContain("키는 저장 후 다시 표시되지 않습니다.");
    expect(panelSource).not.toContain("fetch('/api/cost/estimate'");
  });

  it("does not expose token values, budget mutation paths, or direct Meta writes", () => {
    expect(panelSource).not.toContain("encryptedAccessToken");
    expect(panelSource).not.toContain("tokenIv");
    expect(panelSource).not.toContain("tokenAuthTag");
    expect(panelSource).not.toContain("console.");
    expect(panelSource).not.toContain('sessionStorage.setItem("access_token"');
    expect(panelSource).not.toMatch(/daily_budget|lifetime_budget|BUDGET_MUTATION/);
    expect(panelSource).not.toContain("/api/meta/");
    expect(pageSource).toContain("SettingsPanel");
  });
});
