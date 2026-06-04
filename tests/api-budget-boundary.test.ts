import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ok, parseWriteJson } from "@/lib/api/responses";

function apiRouteFiles(dir = join(process.cwd(), "src", "app", "api")): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return apiRouteFiles(path);
    }
    return entry.name === "route.ts" ? [path] : [];
  });
}

describe("API budget boundary", () => {
  it("blocks executable budget mutation payloads at JSON parse boundary", async () => {
    await expect(
      parseWriteJson(
        new Request("http://localhost/api/variants/design", {
          method: "POST",
          body: JSON.stringify({ actionPayload: { daily_budget: 50000 } })
        })
      )
    ).rejects.toMatchObject({
      code: "BUDGET_MUTATION_HARD_BLOCKED",
      paths: ["$.actionPayload.daily_budget"]
    });
  });

  it("allows budget recommendation text without executable budget fields", async () => {
    await expect(
      parseWriteJson(
        new Request("http://localhost/api/performance-fusion/reports", {
          method: "POST",
          body: JSON.stringify({ recommendation: "예산 증액은 사람이 검토할 추천 텍스트로만 표시합니다." })
        })
      )
    ).resolves.toEqual({
      recommendation: "예산 증액은 사람이 검토할 추천 텍스트로만 표시합니다."
    });
  });

  it("blocks credential-shaped payload fields at JSON parse boundary", async () => {
    await expect(
      parseWriteJson(
        new Request("http://localhost/api/approvals", {
          method: "POST",
          body: JSON.stringify({
            action: "meta_create_ad_paused",
            afterJson: {
              access_token: "must-not-enter-approval-payload",
              token_iv: "must-not-enter-approval-payload"
            }
          })
        })
      )
    ).rejects.toMatchObject({
      code: "CREDENTIAL_PAYLOAD_BLOCKED",
      paths: ["$.afterJson.access_token", "$.afterJson.token_iv"]
    });
  });

  it("redacts credential-shaped fields from API responses", async () => {
    const response = ok({
      connection: {
        id: "connection-1",
        access_token: "must-not-leave-server",
        encryptedAccessToken: "must-not-leave-server",
        nested: {
          clientSecret: "must-not-leave-server",
          tokenAuthTag: "must-not-leave-server"
        }
      }
    });
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(serialized).not.toContain("must-not-leave-server");
    expect(body.connection.access_token).toBe("[REDACTED_CREDENTIAL_FIELD]");
    expect(body.connection.encryptedAccessToken).toBe("[REDACTED_CREDENTIAL_FIELD]");
    expect(body.connection.nested.clientSecret).toBe("[REDACTED_CREDENTIAL_FIELD]");
    expect(body.connection.nested.tokenAuthTag).toBe("[REDACTED_CREDENTIAL_FIELD]");
  });

  it("keeps API routes on guarded write parsing", () => {
    const offenders = apiRouteFiles()
      .map((path) => ({
        path,
        source: readFileSync(path, "utf8")
      }))
      .filter(({ source }) => /\bparseJson\b/.test(source))
      .map(({ path }) => path.replace(process.cwd(), ""));

    expect(offenders).toEqual([]);
  });

  it("handles parseWriteJson budget errors through API error responses", () => {
    const offenders = apiRouteFiles()
      .map((path) => ({
        path,
        source: readFileSync(path, "utf8")
      }))
      .filter(({ source }) => /\bparseWriteJson\b/.test(source) && !/\bhandleError\b/.test(source))
      .map(({ path }) => path.replace(process.cwd(), ""));

    expect(offenders).toEqual([]);
  });
});
