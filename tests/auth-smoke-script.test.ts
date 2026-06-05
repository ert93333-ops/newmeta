import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const smokeScript = readFileSync(join(process.cwd(), "scripts", "verify-supabase-auth-smoke.mjs"), "utf8");

describe("Supabase auth smoke script", () => {
  it("checks tenant bootstrap before tenant-scoped routes", () => {
    expect(smokeScript).toContain('callMe(baseUrl, data.session.access_token)');
    expect(smokeScript).toContain("membership bootstrap /api/me");
    expect(smokeScript).toContain("memberships.some");
    expect(smokeScript).toContain("activeTenant");
  });

  it("verifies Meta connect URL guardrails without exchanging Meta tokens", () => {
    expect(smokeScript).toContain('"/api/integrations/meta/connect-url"');
    expect(smokeScript).toContain("stateBound");
    expect(smokeScript).toContain("stateExpiresAt");
    expect(smokeScript).toContain("https://www.facebook.com/dialog/oauth");
    expect(smokeScript).not.toContain("/api/integrations/meta/callback");
  });

  it("keeps smoke output redacted and checks credential echoes", () => {
    expect(smokeScript).toContain("assertNoCredentialEcho");
    expect(smokeScript).toContain("access_token");
    expect(smokeScript).toContain("refresh_token");
    expect(smokeScript).toContain("client_secret");
    expect(smokeScript).not.toMatch(/console\.log\(.*session/iu);
    expect(smokeScript).not.toMatch(/console\.log\(.*password/iu);
  });
});
