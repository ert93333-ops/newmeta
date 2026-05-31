import type { CreativeManifest, TextBox } from "@/lib/types";

const FORBIDDEN_FINAL_TEXT = [
  "안전영역",
  "안전 영역",
  "권장 사이즈",
  "레이아웃",
  "가이드",
  "safe zone",
  "safe area",
  "1080",
  "px"
];

export interface SafeAreaResult {
  passed: boolean;
  violations: Array<{ text: string; reason: string }>;
}

export function checkForbiddenFinalText(textBoxes: TextBox[]): { passed: boolean; forbiddenTerms: string[] } {
  const combined = textBoxes.map((box) => box.text).join(" ").toLowerCase();
  const forbiddenTerms = FORBIDDEN_FINAL_TEXT.filter((term) => combined.includes(term.toLowerCase()));
  return {
    passed: forbiddenTerms.length === 0,
    forbiddenTerms
  };
}

export function checkPriceAccuracy(manifest: CreativeManifest): { passed: boolean; expected?: string; found: string[] } {
  const expected = manifest.declaredPrice;
  const found = manifest.textBoxes
    .filter((box) => box.role === "price" || /[0-9,]+원/.test(box.text))
    .map((box) => box.text.trim());

  if (!expected) {
    return { passed: true, found };
  }

  return {
    passed: found.includes(expected),
    expected,
    found
  };
}

export function checkSafeArea(manifest: CreativeManifest): SafeAreaResult {
  const bounds = safeAreaBounds(manifest.asset.width, manifest.asset.height);
  const violations = manifest.textBoxes
    .filter((box) => {
      const right = box.x + box.width;
      const bottom = box.y + box.height;
      return box.x < bounds.left || box.y < bounds.top || right > bounds.right || bottom > bounds.bottom;
    })
    .map((box) => ({
      text: box.text,
      reason: "safe area 밖으로 벗어났습니다."
    }));

  return {
    passed: violations.length === 0,
    violations
  };
}

export function safeAreaBounds(width: number, height: number): { left: number; right: number; top: number; bottom: number } {
  if (width === 1080 && height === 1920) {
    return { left: 80, right: 1000, top: 250, bottom: 1580 };
  }
  if (width === 1080 && height === 1350) {
    return { left: 80, right: 1000, top: 100, bottom: 1250 };
  }
  if (width === 1080 && height === 1080) {
    return { left: 80, right: 1000, top: 80, bottom: 1000 };
  }
  return {
    left: Math.round(width * 0.075),
    right: Math.round(width * 0.925),
    top: Math.round(height * 0.075),
    bottom: Math.round(height * 0.925)
  };
}
