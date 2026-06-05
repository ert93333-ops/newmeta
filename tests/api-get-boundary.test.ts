import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GET as getMe } from "@/app/api/me/route";
import { GET as getMetaAdAccounts } from "@/app/api/meta/ad-accounts/route";
import { GET as getMetaConnectUrl } from "@/app/api/integrations/meta/connect-url/route";

const ENV_KEYS = [
  "NODE_ENV",
  "VERCEL_ENV",
  "HERMES_AUTH_MODE",
  "HERMES_OAUTH_STATE_SECRET",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
] as const;

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

function setProductionWithoutSupabase(): void {
  for (const key of ENV_KEYS) {
    delete mutableEnv[key];
  }
  mutableEnv.NODE_ENV = "production";
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function apiRouteFiles(dir = join(process.cwd(), "src", "app", "api")): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return apiRouteFiles(path);
    }
    return entry.name === "route.ts" ? [path] : [];
  });
}

describe("API GET auth boundary", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("handles /api/me auth failures through the API error shape", async () => {
    setProductionWithoutSupabase();

    const response = await getMe(new Request("http://localhost/api/me"));
    const body = await json(response);

    expect(response.status).toBe(401);
    expect((body.error as { code?: string }).code).toBe("SUPABASE_AUTH_REQUIRED");
  });

  it("requires auth for Meta ad account reads", async () => {
    setProductionWithoutSupabase();

    const response = await getMetaAdAccounts(new Request("http://localhost/api/meta/ad-accounts"));
    const body = await json(response);

    expect(response.status).toBe(401);
    expect((body.error as { code?: string }).code).toBe("SUPABASE_AUTH_REQUIRED");
  });

  it("requires auth before generating a Meta connect URL", async () => {
    setProductionWithoutSupabase();

    const response = await getMetaConnectUrl(new Request("http://localhost/api/integrations/meta/connect-url"));
    const body = await json(response);

    expect(response.status).toBe(401);
    expect((body.error as { code?: string }).code).toBe("SUPABASE_AUTH_REQUIRED");
  });

  it("adds a signed state to Meta connect URLs without raw tenant or user ids", async () => {
    mutableEnv.HERMES_AUTH_MODE = "mock";
    mutableEnv.HERMES_OAUTH_STATE_SECRET = "state-secret-with-at-least-32-characters";

    const response = await getMetaConnectUrl(new Request("http://localhost/api/integrations/meta/connect-url"));
    const body = await json(response);
    const connectUrl = new URL(String(body.connectUrl));
    const state = connectUrl.searchParams.get("state") ?? "";
    const [encodedPayload] = state.split(".");
    const decodedStatePayload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    const serializedStatePayload = JSON.stringify(decodedStatePayload);

    expect(response.status).toBe(200);
    expect(body.stateBound).toBe(true);
    expect(body.stateExpiresAt).toEqual(expect.any(String));
    expect(state).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);
    expect(serializedStatePayload).not.toContain("00000000-0000-0000-0000-000000000001");
    expect(serializedStatePayload).not.toContain("00000000-0000-0000-0000-000000000010");
  });

  it("keeps authenticated GET routes wrapped in handleError", () => {
    const offenders = apiRouteFiles()
      .map((path) => ({
        path,
        source: readFileSync(path, "utf8")
      }))
      .filter(({ source }) => /export (async )?function GET\b/.test(source))
      .filter(({ source }) => /\bresolveUserContext\b/.test(source))
      .filter(({ source }) => !/\bhandleError\b/.test(source))
      .map(({ path }) => path.replace(process.cwd(), ""));

    expect(offenders).toEqual([]);
  });
});
