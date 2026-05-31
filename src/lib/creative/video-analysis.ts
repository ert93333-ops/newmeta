import type { CreativeAssetMetadata, Score } from "@/lib/types";

export interface VideoSegmentAnalysis {
  range: "0.0~0.5초" | "0.5~1.0초" | "1~3초" | "3~5초" | "5~10초" | "10초 이후";
  productVisible: boolean;
  textVisible: boolean;
  priceVisible: boolean;
  ctaVisible: boolean;
  motionLevel: "low" | "medium" | "high";
  retentionRisk: "low" | "medium" | "high";
}

export interface VideoCreativeAnalysis {
  metadata: CreativeAssetMetadata;
  segments: VideoSegmentAnalysis[];
  scores: Score[];
  silentViewingReady: boolean;
}

export function analyzeVideoCreative(asset: CreativeAssetMetadata): VideoCreativeAnalysis {
  const hasDuration = typeof asset.durationSeconds === "number" && asset.durationSeconds > 0;
  const segments = defaultSegments(hasDuration ? asset.durationSeconds ?? 0 : 0);
  const silentViewingReady = segments.some((segment) => segment.textVisible);

  return {
    metadata: asset,
    segments,
    silentViewingReady,
    scores: [
      { name: "First 3s Hook Score", value: segments[2]?.productVisible ? 75 : 45, evidence: ["0~3초 제품/텍스트 노출 기준"] },
      { name: "Product Timing Score", value: segments[0]?.productVisible || segments[1]?.productVisible ? 82 : 50, evidence: ["제품 첫 등장 시간 mock 분석"] },
      { name: "Scene Rhythm Score", value: 68, evidence: ["컷 전환 속도는 실제 프레임 분석 worker에서 보강합니다."] },
      { name: "Subtitle Score", value: silentViewingReady ? 80 : 35, evidence: [silentViewingReady ? "무음 시청용 텍스트가 있습니다." : "자막/텍스트 정보가 약합니다."] },
      { name: "Audio Hook Score", value: 50, evidence: ["오디오 분석 worker 연결 전 기본값입니다."] },
      { name: "Message Clarity Score", value: 65, evidence: ["메시지 명확도는 segment OCR 이후 보강합니다."] },
      { name: "CTA Timing Score", value: segments.some((segment) => segment.ctaVisible) ? 72 : 30, evidence: ["CTA 등장 시점 기준"] },
      { name: "Retention Risk Score", value: 60, evidence: ["초기 이탈 위험 mock 분석"] },
      { name: "Placement Fit Score", value: asset.width / asset.height < 0.7 ? 80 : 55, evidence: ["9:16 우선 placement 기준"] },
      { name: "Policy Risk Score", value: 75, evidence: ["정책 위험 텍스트/프레임 분석 worker에서 보강합니다."] }
    ]
  };
}

function defaultSegments(durationSeconds: number): VideoSegmentAnalysis[] {
  const hasLongTail = durationSeconds > 10;
  return [
    segment("0.0~0.5초", true, true, false, false, "high", "low"),
    segment("0.5~1.0초", true, true, false, false, "high", "low"),
    segment("1~3초", true, true, false, false, "medium", "medium"),
    segment("3~5초", true, true, true, false, "medium", "medium"),
    segment("5~10초", true, true, true, true, "medium", "medium"),
    segment("10초 이후", hasLongTail, hasLongTail, false, hasLongTail, "low", hasLongTail ? "medium" : "high")
  ];
}

function segment(
  range: VideoSegmentAnalysis["range"],
  productVisible: boolean,
  textVisible: boolean,
  priceVisible: boolean,
  ctaVisible: boolean,
  motionLevel: VideoSegmentAnalysis["motionLevel"],
  retentionRisk: VideoSegmentAnalysis["retentionRisk"]
): VideoSegmentAnalysis {
  return { range, productVisible, textVisible, priceVisible, ctaVisible, motionLevel, retentionRisk };
}
