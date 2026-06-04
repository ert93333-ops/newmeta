import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/integrations/meta/callback/route";

const callbackRouteSource = readFileSync(
  join(process.cwd(), "src", "app", "api", "integrations", "meta", "callback", "route.ts"),
  "utf8"
);

describe("Meta OAuth callback response security", () => {
  it("does not return token-shaped fields to the client", () => {
    expect(callbackRouteSource).not.toMatch(/\b(access_token|refresh_token|client_secret)\b/i);
    expect(callbackRouteSource).not.toContain("token:");
    expect(callbackRouteSource).not.toContain('"token"');
  });

  it("only returns token storage status metadata", () => {
    expect(callbackRouteSource).toContain("encryptedTokenStored");
  });

  it("omits token-shaped fields from the actual callback response", async () => {
    const response = await POST(
      new Request("http://localhost/api/integrations/meta/callback", {
        method: "POST",
        body: JSON.stringify({ code: "mock-code", scopes: ["ads_read"] })
      })
    );
    const body = (await response.json()) as Record<string, unknown>;
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(201);
    expect(body).not.toHaveProperty("token");
    expect(serialized).not.toMatch(/\b(access_token|refresh_token|client_secret)\b/i);
    expect(serialized).toContain("encryptedTokenStored");
  });

  it("rejects direct access token payloads at the callback boundary", async () => {
    const response = await POST(
      new Request("http://localhost/api/integrations/meta/callback", {
        method: "POST",
        body: JSON.stringify({ access_token: "must-not-be-accepted" })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("CREDENTIAL_PAYLOAD_BLOCKED");
    expect(JSON.stringify(body)).not.toContain("must-not-be-accepted");
  });
});
