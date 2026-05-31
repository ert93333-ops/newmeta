import { describe, expect, it } from "vitest";
import { runDraftPreflight } from "@/lib/drafts/preflight";
import type { CreativeManifest } from "@/lib/types";

const manifest: CreativeManifest = {
  asset: { type: "image", width: 1080, height: 1350 },
  declaredPrice: "9,900원",
  placements: ["facebook_feed"],
  linkUrl: "https://example.com",
  textBoxes: [
    { text: "강력한 첫 문장", x: 120, y: 160, width: 360, height: 80, role: "hook" },
    { text: "9,900원", x: 120, y: 900, width: 220, height: 80, role: "price" },
    { text: "바로 보기", x: 120, y: 1020, width: 220, height: 80, role: "cta" }
  ]
};

describe("draft preflight", () => {
  it("requires approval for clean PAUSED draft creation", () => {
    const result = runDraftPreflight({
      manifest,
      pageId: "page_1",
      linkUrl: "https://example.com"
    });
    expect(result.status).toBe("approval_required");
  });

  it("hard-blocks budget payloads", () => {
    const result = runDraftPreflight({
      manifest,
      pageId: "page_1",
      actionPayload: { daily_budget: 50000 }
    });
    expect(result.status).toBe("blocked");
  });
});
