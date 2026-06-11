import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const panelSource = readFileSync(join(process.cwd(), "src", "app", "meta-connection-panel.tsx"), "utf8");
const pageSource = readFileSync(join(process.cwd(), "src", "app", "page.tsx"), "utf8");

describe("Meta connection panel", () => {
  it("binds the browser handoff to the same tenant context as the OAuth state request", () => {
    expect(panelSource).toContain("hermes:tenant-id");
    expect(panelSource).toContain("/api/integrations/meta/connect-url");
    expect(panelSource).toContain("/api/me");
    expect(panelSource).toContain('"x-tenant-id"');
    expect(panelSource).toContain("sessionStorage.setItem");
    expect(panelSource).toContain("localStorage.setItem");
    expect(panelSource).not.toContain("00000000-0000-0000-0000-000000000001");
  });

  it("uses Supabase session auth without rendering customer token inputs", () => {
    expect(panelSource).toContain("createSupabaseBrowserClient");
    expect(panelSource).toContain("headers.authorization");
    expect(panelSource).toContain("<select");
    expect(panelSource).not.toMatch(/<input[^>]+(?:name|id|placeholder|aria-label)=["'][^"']*(token|secret)/iu);
    expect(panelSource).not.toContain("META_APP_SECRET");
    expect(panelSource).not.toContain("META_CLIENT_SECRET");
  });

  it("surfaces signed-state metadata on the launch dashboard", () => {
    expect(pageSource).toContain("MetaConnectionPanel");
    expect(panelSource).toContain("stateExpiresAt");
    expect(panelSource).toContain("stateBound");
    expect(panelSource).toContain("메타 OAuth 열기");
  });
});
