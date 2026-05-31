import { describe, expect, it } from "vitest";
import { validatePlacement } from "@/lib/placement/placement-validator";

describe("placement validator", () => {
  it("requires 9:16 variant for stories from 4:5 asset", () => {
    const result = validatePlacement({
      asset: { type: "image", width: 1080, height: 1350 },
      placements: ["instagram_stories"]
    });
    expect(result.status).toBe("requires_variant");
    expect(result.error1487569Risk).toBe(true);
  });

  it("passes 4:5 feed asset", () => {
    const result = validatePlacement({
      asset: { type: "image", width: 1080, height: 1350 },
      placements: ["facebook_feed", "instagram_feed"]
    });
    expect(result.status).toBe("compatible");
  });
});
