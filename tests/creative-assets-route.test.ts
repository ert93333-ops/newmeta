import { afterEach, describe, expect, it } from "vitest";
import { POST as creativeAssetsRoute } from "@/app/api/creative-assets/route";
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
  return new Request("http://localhost/api/creative-assets", {
    method: "POST",
    headers: {
      "x-tenant-id": tenantId
    },
    body: JSON.stringify(body)
  });
}

describe("creative assets route", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("requires production authentication before creating a creative asset", async () => {
    clearEnv();
    mutableEnv.NODE_ENV = "production";

    const response = await creativeAssetsRoute(
      request({
        asset: { type: "image", width: 1080, height: 1350 }
      })
    );
    const body = await json(response);

    expect(response.status).toBe(401);
    expect((body.error as { code?: string }).code).toBe("SUPABASE_AUTH_REQUIRED");
  });

  it("rejects invalid creative asset payloads", async () => {
    setMockEnv();

    const response = await creativeAssetsRoute(
      request({
        asset: { type: "image", width: 1080, height: 1350, durationSeconds: 10 }
      })
    );
    const body = await json(response);

    expect(response.status).toBe(400);
    expect((body.error as { code?: string }).code).toBe("CREATIVE_ASSET_PAYLOAD_INVALID");
  });

  it("persists normalized image assets with tenant-scoped metadata", async () => {
    setMockEnv();
    const repository = new MemoryHermesRepository();

    const response = await creativeAssetsRoute(
      request({
        asset: {
          type: "image",
          width: 1080,
          height: 1350,
          mimeType: "image/png",
          fileSizeBytes: 245760
        },
        storagePath: "creative-assets/tenant-a/asset-image-1.png",
        sourceUrl: "https://cdn.example.com/asset-image-1.png",
        checksumSha256: "sha256-image-1",
        originalFilename: "asset-image-1.png",
        tags: ["ugc", "sale"],
        metadata: {
          campaignHint: "launch"
        }
      })
    );
    const body = await json(response);
    const asset = body.asset as { id?: string };
    const persisted = await repository.getAsset(request({}), context, String(asset.id));

    expect(response.status).toBe(201);
    expect(body.asset).toMatchObject({
      id: expect.any(String),
      tenantId,
      createdBy: mockUserId,
      assetType: "image",
      storagePath: "creative-assets/tenant-a/asset-image-1.png",
      sourceUrl: "https://cdn.example.com/asset-image-1.png",
      sha256: "sha256-image-1",
      width: 1080,
      height: 1350,
      mimeType: "image/png"
    });
    expect(persisted).toMatchObject({
      id: asset.id,
      tenantId,
      assetType: "image",
      sha256: "sha256-image-1",
      metadataJson: {
        fileSizeBytes: 245760,
        originalFilename: "asset-image-1.png",
        tags: ["ugc", "sale"],
        campaignHint: "launch"
      }
    });
  });

  it("persists video assets with required duration", async () => {
    setMockEnv();

    const response = await creativeAssetsRoute(
      request({
        asset: {
          type: "video",
          width: 1080,
          height: 1920,
          durationSeconds: 15,
          mimeType: "video/mp4"
        }
      })
    );
    const body = await json(response);

    expect(response.status).toBe(201);
    expect(body.asset).toMatchObject({
      assetType: "video",
      width: 1080,
      height: 1920,
      durationSeconds: 15,
      mimeType: "video/mp4"
    });
  });
});
