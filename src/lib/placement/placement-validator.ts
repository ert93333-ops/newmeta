import type { CreativeAssetMetadata, Placement } from "@/lib/types";

export interface PlacementValidationInput {
  asset: CreativeAssetMetadata;
  placements: Placement[];
  objective?: string;
  creativeType?: string;
}

export interface PlacementValidationResult {
  status: "compatible" | "incompatible" | "risky" | "requires_variant";
  error1487569Risk: boolean;
  ratio: number;
  issues: string[];
  recommendations: string[];
  placementResults: Record<Placement, "compatible" | "risky" | "requires_variant" | "incompatible">;
}

const RATIO_TOLERANCE = 0.04;

export function validatePlacement(input: PlacementValidationInput): PlacementValidationResult {
  const ratio = input.asset.width / input.asset.height;
  const placementResults = {} as PlacementValidationResult["placementResults"];
  const issues: string[] = [];
  const recommendations = new Set<string>();

  for (const placement of input.placements) {
    const result = validateSinglePlacement(input.asset, placement, ratio);
    placementResults[placement] = result;
    if (result === "requires_variant") {
      issues.push(`${placement}: 선택한 placement에 맞는 전용 비율 variant가 필요합니다.`);
      recommendations.add(recommendVariant(placement));
    }
    if (result === "incompatible") {
      issues.push(`${placement}: 현재 소재 사양으로는 호환되지 않을 수 있습니다.`);
    }
    if (result === "risky") {
      issues.push(`${placement}: crop, safe area, 길이 조건을 추가 검수해야 합니다.`);
    }
  }

  if (input.asset.type === "video") {
    if (!input.asset.durationSeconds || input.asset.durationSeconds <= 0) {
      issues.push("video: 영상 길이 정보가 없어 placement 호환성을 확정할 수 없습니다.");
    }
    if (input.asset.durationSeconds && input.asset.durationSeconds > 240) {
      issues.push("video: 긴 영상은 일부 placement에서 제한될 수 있습니다.");
    }
  }

  const results = Object.values(placementResults);
  const error1487569Risk = results.includes("requires_variant") || results.includes("incompatible");
  const status = resolveOverallStatus(results);

  return {
    status,
    error1487569Risk,
    ratio,
    issues,
    recommendations: Array.from(recommendations),
    placementResults
  };
}

function validateSinglePlacement(
  asset: CreativeAssetMetadata,
  placement: Placement,
  ratio: number
): "compatible" | "risky" | "requires_variant" | "incompatible" {
  if (asset.width < 600 || asset.height < 600) {
    return "incompatible";
  }

  if (placement === "instagram_stories" || placement === "facebook_stories" || placement === "instagram_reels" || placement === "facebook_reels") {
    return isNear(ratio, 9 / 16) ? "compatible" : "requires_variant";
  }

  if (placement === "facebook_feed" || placement === "instagram_feed") {
    if (isNear(ratio, 4 / 5) || isNear(ratio, 1)) {
      return "compatible";
    }
    return "risky";
  }

  if (placement === "right_column" || placement === "instream_video") {
    return isNear(ratio, 1.91) || isNear(ratio, 16 / 9) ? "compatible" : "requires_variant";
  }

  return "risky";
}

function isNear(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= RATIO_TOLERANCE;
}

function resolveOverallStatus(results: Array<"compatible" | "risky" | "requires_variant" | "incompatible">): PlacementValidationResult["status"] {
  if (results.includes("incompatible")) {
    return "incompatible";
  }
  if (results.includes("requires_variant")) {
    return "requires_variant";
  }
  if (results.includes("risky")) {
    return "risky";
  }
  return "compatible";
}

function recommendVariant(placement: Placement): string {
  if (placement.includes("stories") || placement.includes("reels")) {
    return "Stories/Reels용 1080x1920 9:16 variant를 생성하세요.";
  }
  if (placement === "right_column" || placement === "instream_video") {
    return "Landscape placement용 1200x628 또는 1920x1080 variant를 생성하세요.";
  }
  return "Placement asset customization을 사용해 placement별 소재를 분리하세요.";
}
