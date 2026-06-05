import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/integrations/meta/callback/route";

const callbackRouteSource = readFileSync(
  join(process.cwd(), "src", "app", "api", "integrations", "meta", "callback", "route.ts"),
  "utf8"
);

const ENV_KEYS = ["NEXT_PUBLIC_APP_URL"] as const;
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const mutableEnv = process.env as unknown as Record<string, string | undefined>;

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

describe("Meta OAuth browser callback handoff", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("redirects Meta GET callbacks to the client handoff page with code and state in the fragment", async () => {
    mutableEnv.NEXT_PUBLIC_APP_URL = "https://app.newmeta.test";
    const response = await GET(
      new Request("https://app.newmeta.test/api/integrations/meta/callback?code=meta-code&state=signed-state")
    );
    const location = response.headers.get("location") ?? "";
    const redirectUrl = new URL(location);
    const fragment = new URLSearchParams(redirectUrl.hash.replace(/^#/u, ""));

    expect(response.status).toBe(303);
    expect(redirectUrl.origin).toBe("https://app.newmeta.test");
    expect(redirectUrl.pathname).toBe("/meta/oauth/callback");
    expect(redirectUrl.search).toBe("");
    expect(fragment.get("code")).toBe("meta-code");
    expect(fragment.get("state")).toBe("signed-state");
  });

  it("forwards Meta OAuth errors without attempting token exchange", async () => {
    const response = await GET(
      new Request(
        "https://app.newmeta.test/api/integrations/meta/callback?error=access_denied&error_description=cancelled"
      )
    );
    const location = response.headers.get("location") ?? "";
    const redirectUrl = new URL(location);
    const fragment = new URLSearchParams(redirectUrl.hash.replace(/^#/u, ""));

    expect(response.status).toBe(303);
    expect(fragment.get("error")).toBe("access_denied");
    expect(fragment.get("error_description")).toBe("cancelled");
    expect(redirectUrl.search).toBe("");
  });

  it("keeps GET callback as handoff only while POST owns token exchange", () => {
    const getSection = callbackRouteSource
      .slice(callbackRouteSource.indexOf("export async function GET"))
      .split("export async function POST")[0];

    expect(getSection).not.toContain("connectMetaOAuth");
    expect(getSection).not.toContain("saveMetaConnection");
    expect(getSection).not.toMatch(/\b(access_token|refresh_token|client_secret)\b/i);
  });
});
