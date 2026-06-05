import { afterEach, describe, expect, it } from "vitest";
import { POST as creativeAnalysisRoute } from "@/app/api/creative-analysis/jobs/route";
import { MemoryHermesRepository } from "@/lib/repositories/hermes-repository";
import type { UserContext } from "@/lib/types";

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
const tenantId = "00000000-0000-0000-0000-000000000001";
const mockUserId = "00000000-0000-0000-0000-000000000010";
const context: UserContext = {
  userId: mockUserId,
  tenantId,
  role: "marketer"
};

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

function setMockEnv(): void {
  clearEnv();
  mutableEnv.HERMES_AUTH_MODE = "mock";
  mutableEnv.HERMES_DEFAULT_TENANT_ID = tenantId;
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function request(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/creative-analysis/jobs", {
    method: "POST",
    headers: {
      "x-tenant-id": tenantId
    },
    body: JSON.stringify(body)
  });
}

describe("creative analysis route", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("requires production authentication before creating a creative analysis job", async () => {
    clearEnv();
    mutableEnv.NODE_ENV = "production";

    const response = await creativeAnalysisRoute(
      request({
        asset: { id: "asset-1", type: "image", width: 1080, height: 1350 },
        textBoxes: []
      })
    );
    const body = await json(response);

    expect(response.status).toBe(401);
    expect((body.error as { code?: string }).code).toBe("SUPABASE_AUTH_REQUIRED");
  });

  it("fails closed when the creative asset has not been persisted yet", async () => {
    setMockEnv();

    const response = await creativeAnalysisRoute(
      request({
        asset: { type: "image", width: 1080, height: 1350 },
        textBoxes: []
      })
    );
    const body = await json(response);

    expect(response.status).toBe(400);
    expect((body.error as { code?: string }).code).toBe("CREATIVE_ASSET_ID_REQUIRED");
  });

  it("fails closed when the creative asset id does not exist for the tenant", async () => {
    setMockEnv();

    const response = await creativeAnalysisRoute(
      request({
        asset: { id: "asset-missing-1", type: "image", width: 1080, height: 1350 },
        textBoxes: []
      })
    );
    const body = await json(response);

    expect(response.status).toBe(404);
    expect((body.error as { code?: string }).code).toBe("CREATIVE_ASSET_NOT_FOUND");
  });

  it("persists image analysis into dedicated creative analysis tables", async () => {
    setMockEnv();
    const repository = new MemoryHermesRepository();
    await repository.saveAsset(request({}), {
      id: "asset-image-1",
      tenantId,
      createdBy: mockUserId,
      assetType: "image",
      width: 1080,
      height: 1350,
      mimeType: "image/png",
      metadataJson: {
        fileSizeBytes: 245760
      }
    });

    const response = await creativeAnalysisRoute(
      request({
        asset: { id: "asset-image-1", type: "video", width: 1, height: 1 },
        textBoxes: [
          { text: "Hook", x: 120, y: 140, width: 300, height: 80, role: "hook" },
          { text: "9,900", x: 120, y: 860, width: 220, height: 80, role: "price" },
          { text: "Shop now", x: 120, y: 1020, width: 220, height: 80, role: "cta" }
        ],
        declaredPrice: "9,900",
        placements: ["facebook_feed", "instagram_stories"]
      })
    );
    const body = await json(response);
    const analysisJob = await repository.getCreativeAnalysisJob(request({}), context, String(body.id));
    const features = await repository.listCreativeFeatures(request({}), context, "asset-image-1");
    const scores = await repository.listCreativeComponentScores(request({}), context, "asset-image-1");

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      id: expect.any(String),
      tenantId,
      createdBy: mockUserId,
      type: "creative_analysis",
      status: "succeeded"
    });
    expect(analysisJob).toMatchObject({
      id: body.id,
      tenantId,
      assetId: "asset-image-1",
      analysisType: "image"
    });
    expect(features.map((item) => item.featureType).sort()).toEqual(["checks", "placement", "recommendations"]);
    expect(scores).toHaveLength(11);
  });

  it("persists video segments for video creative analysis", async () => {
    setMockEnv();
    const repository = new MemoryHermesRepository();
    await repository.saveAsset(request({}), {
      id: "asset-video-1",
      tenantId,
      createdBy: mockUserId,
      assetType: "video",
      width: 1080,
      height: 1920,
      durationSeconds: 15,
      mimeType: "video/mp4",
      metadataJson: {}
    });

    const response = await creativeAnalysisRoute(
      request({
        asset: {
          id: "asset-video-1",
          type: "image",
          width: 640,
          height: 640
        },
        textBoxes: []
      })
    );
    const body = await json(response);
    const segments = await repository.listVideoSegments(request({}), context, "asset-video-1");
    const scores = await repository.listCreativeComponentScores(request({}), context, "asset-video-1");

    expect(response.status).toBe(201);
    expect((body.result as { segments?: unknown[] }).segments).toHaveLength(6);
    expect(segments).toHaveLength(6);
    expect(segments[0]).toMatchObject({
      assetId: "asset-video-1",
      startSeconds: 0,
      endSeconds: 0.5
    });
    expect(scores).toHaveLength(10);
  });
});
