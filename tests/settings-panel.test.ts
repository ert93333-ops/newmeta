import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const panelSource = readFileSync(join(process.cwd(), "src", "app", "settings-panel.tsx"), "utf8");
const pageSource = readFileSync(join(process.cwd(), "src", "app", "page.tsx"), "utf8");

describe("Settings panel", () => {
  it("loads and saves tenant-scoped provider settings through the server settings route", () => {
    expect(panelSource).toContain('method: "GET"');
    expect(panelSource).toContain('method: "PATCH"');
    expect(panelSource).toContain("/api/settings/${encodeURIComponent(normalizedProvider)}");
    expect(panelSource).toContain("/api/settings/${encodeURIComponent(providerName)}");
    expect(panelSource).toContain('"x-tenant-id"');
    expect(panelSource).toContain("headers.authorization");
    expect(panelSource).toContain("createSupabaseBrowserClient");
  });

  it("keeps write access role-gated and server-owned", () => {
    expect(panelSource).toContain("ROLE_RANK.marketer");
    expect(panelSource).toContain("ROLE_ACCESS_DENIED");
    expect(panelSource).toContain("toSettingsPayload");
    expect(panelSource).toContain("저장 전까지 차단");
    expect(panelSource).not.toContain("fetch('/api/cost/estimate'");
  });

  it("does not expose token values, budget mutation paths, or direct Meta writes", () => {
    expect(panelSource).not.toContain("encryptedAccessToken");
    expect(panelSource).not.toContain("console.");
    expect(panelSource).not.toContain("sessionStorage.setItem(\"access_token\"");
    expect(panelSource).not.toMatch(/daily_budget|lifetime_budget|BUDGET_MUTATION/);
    expect(panelSource).not.toContain("/api/meta/");
    expect(pageSource).toContain("SettingsPanel");
  });
});
