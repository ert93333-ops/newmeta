import { describe, expect, it } from "vitest";
import { checkForbiddenFinalText, checkPriceAccuracy, checkSafeArea } from "@/lib/creative/checkers";
import type { CreativeManifest } from "@/lib/types";

const manifest: CreativeManifest = {
  asset: { type: "image", width: 1080, height: 1350 },
  declaredPrice: "9,900원",
  textBoxes: [
    { text: "오늘만 특가", x: 120, y: 150, width: 300, height: 80, role: "hook" },
    { text: "9,900원", x: 120, y: 900, width: 220, height: 80, role: "price" }
  ]
};

describe("creative checkers", () => {
  it("passes exact KRW price", () => {
    expect(checkPriceAccuracy(manifest).passed).toBe(true);
  });

  it("blocks final image guide text", () => {
    expect(checkForbiddenFinalText([{ text: "safe zone", x: 1, y: 1, width: 10, height: 10 }]).passed).toBe(false);
  });

  it("detects safe area violations", () => {
    expect(
      checkSafeArea({
        ...manifest,
        textBoxes: [{ text: "edge", x: 1, y: 1, width: 200, height: 80 }]
      }).passed
    ).toBe(false);
  });
});
