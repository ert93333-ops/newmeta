import { afterEach, describe, expect, it } from "vitest";
import { POST as preflightRoute } from "@/app/api/drafts/preflight/route";
import { POST as placementValidateRoute } from "@/app/api/placement/validate/route";

const ENV_KEYS = [
  "NODE_ENV",
  "VERCEL_ENV",
  "HERMES_AUTH_MODE",
  "HERMES_DEFAULT_TENANT_ID",
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

function clearEnv(): void {
  for (const key of ENV_KEYS) {
    delete mutableEnv[key];
  }
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function setMockEnv(): void {
  clearEnv();
  mutableEnv.HERMES_AUTH_MODE = "mock";
  mutableEnv.HERMES_DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";
}

describe("analysis route auth boundary", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("requires production authentication before running draft preflight", async () => {
    clearEnv();
    mutableEnv.NODE_ENV = "production";

    const response = await preflightRoute(
      new Request("http://localhost/api/drafts/preflight", {
        method: "POST",
        body: JSON.stringify({})
      })
    );
    const body = await json(response);

    expect(response.status).toBe(401);
    expect((body.error as { code?: string }).code).toBe("SUPABASE_AUTH_REQUIRED");
  });

  it("requires production authentication before placement validation", async () => {
    clearEnv();
    mutableEnv.NODE_ENV = "production";

    const response = await placementValidateRoute(
      new Request("http://localhost/api/placement/validate", {
        method: "POST",
        body: JSON.stringify({
          asset: { type: "image", width: 1080, height: 1350 },
          placements: ["facebook_feed"]
        })
      })
    );
    const body = await json(response);

    expect(response.status).toBe(401);
    expect((body.error as { code?: string }).code).toBe("SUPABASE_AUTH_REQUIRED");
  });

  it("still allows draft preflight in local mock mode", async () => {
    setMockEnv();

    const response = await preflightRoute(
      new Request("http://localhost/api/drafts/preflight", {
        method: "POST",
        body: JSON.stringify({
          manifest: {
            asset: { type: "image", width: 1080, height: 1350 },
            linkUrl: "https://example.com",
            textBoxes: [
              { text: "Hook", x: 120, y: 160, width: 360, height: 80, role: "hook" },
              { text: "9,900", x: 120, y: 900, width: 220, height: 80, role: "price" },
              { text: "Shop now", x: 120, y: 1020, width: 220, height: 80, role: "cta" }
            ],
            placements: ["facebook_feed"]
          },
          pageId: "page_1",
          linkUrl: "https://example.com"
        })
      })
    );
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.status).toBe("approval_required");
  });

  it("still allows placement validation in local mock mode", async () => {
    setMockEnv();

    const response = await placementValidateRoute(
      new Request("http://localhost/api/placement/validate", {
        method: "POST",
        body: JSON.stringify({
          asset: { type: "image", width: 1080, height: 1350 },
          placements: ["facebook_feed", "instagram_stories"]
        })
      })
    );
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.status).toBe("requires_variant");
  });
});
