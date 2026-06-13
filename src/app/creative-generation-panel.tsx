"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { BarChart3, ImagePlus, RefreshCw, Search, Send, Video, WandSparkles } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const TENANT_STORAGE_KEY = "hermes:tenant-id";

const PROVIDERS = [
  { value: "openai", label: "OpenAI", endpointUrl: "https://api.openai.com/v1" },
  { value: "anthropic", label: "Claude / Anthropic", endpointUrl: "https://api.anthropic.com/v1" },
  { value: "higgsfield", label: "Higgsfield", endpointUrl: "https://api.higgsfield.ai/v1" },
  { value: "generic_http", label: "범용 HTTPS", endpointUrl: "" }
] as const;

type OperationType = "image_generation" | "video_generation";
type ProviderName = (typeof PROVIDERS)[number]["value"];

interface CostEstimateResponse {
  status?: string;
  estimatedCostKrw?: number;
  effectiveDailyCapKrw?: number;
  approval?: {
    id: string;
    status: string;
    objectType: string;
  };
  error?: {
    code?: string;
  };
}

interface OperationPlan {
  registrationMode: "paused_draft_after_qa";
  approvalGate: string;
  steps: string[];
  abTest: {
    control: string;
    variant: string;
    primaryMetric: string;
    secondaryMetrics: string[];
    minimumData: string;
    stopCondition: string;
  };
  automationBoundaries: string[];
}

interface DashboardSummary {
  topAds?: Array<{
    name: string;
    metaAdId?: string;
    spend: number;
    impressions: number;
    purchases: number;
    addToCart: number;
    ctr: number;
    creativeReady: boolean;
  }>;
  recommendations?: Array<{
    severity: "observe" | "low" | "medium" | "high";
    action: string;
    reason: string;
    nextStep: string;
    adName?: string;
    metaAdId?: string;
    creativeBrief?: {
      recommendedPrompt: string;
      changedVariable: string;
      controlledVariables: string[];
      objective: string;
    };
    operationPlan?: OperationPlan;
  }>;
  totals?: {
    spend: number;
    impressions: number;
    clicks: number;
    purchases: number;
    addToCart: number;
    ctr: number;
    landingRate: number;
  };
  error?: {
    code?: string;
  };
}

interface ProductReferenceExtraction {
  sources: {
    productImageUrl?: string;
    homepageUrl?: string;
    canonicalUrl?: string;
  };
  productFacts: {
    title?: string;
    description?: string;
    brand?: string;
    name?: string;
    image?: string;
  };
  candidateImages: string[];
  variantCount: number;
  extractionPolicy: {
    mode: "product_only";
    rawHtmlStored: false;
    javascriptExecuted: false;
    generatedClaimsAllowed: false;
  };
  generationInstruction: string;
}

interface ProductReferenceExtractResponse {
  extraction?: ProductReferenceExtraction;
  error?: {
    code?: string;
  };
}

export function CreativeGenerationPanel() {
  const [operationType, setOperationType] = useState<OperationType>("image_generation");
  const [providerName, setProviderName] = useState<ProviderName>(PROVIDERS[0].value);
  const [prompt, setPrompt] = useState("");
  const [productImageUrl, setProductImageUrl] = useState("");
  const [homepageUrl, setHomepageUrl] = useState("");
  const [variantCount, setVariantCount] = useState(3);
  const [productExtraction, setProductExtraction] = useState<ProductReferenceExtraction | null>(null);
  const [status, setStatus] = useState("소재 생성 승인 요청을 준비할 수 있습니다.");
  const [extractionStatus, setExtractionStatus] = useState("상품 이미지나 홈페이지를 입력한 뒤 상품 정보를 추출하세요.");
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState("기존 광고 성과와 소재 맥락을 불러오는 중입니다.");
  const selectedProvider = PROVIDERS.find((item) => item.value === providerName) ?? PROVIDERS[0];
  const productReference = useMemo(
    () => buildProductReference(productImageUrl, homepageUrl, variantCount, productExtraction),
    [productImageUrl, homepageUrl, variantCount, productExtraction]
  );
  const rationale = useMemo(
    () => buildCreativeRationale(summary, operationType, prompt, productReference),
    [summary, operationType, prompt, productReference]
  );
  const requestPrompt = prompt.trim() || rationale.recommendedPrompt;

  useEffect(() => {
    void loadCreativeContext();
  }, []);

  async function loadCreativeContext() {
    const headers = await createTenantHeaders();
    if (!headers.authorization && !headers["x-tenant-id"]) {
      setAnalysisStatus("추천 맥락을 불러오려면 로그인 또는 테넌트 ID가 필요합니다.");
      return;
    }
    const response = await fetch("/api/dashboard/summary", { headers });
    const body = (await response.json()) as DashboardSummary;
    if (!response.ok) {
      setAnalysisStatus(body.error?.code ?? `HTTP_${response.status}`);
      return;
    }
    setSummary(body);
    setAnalysisStatus("기존 광고 성과에서 추천 맥락을 불러왔습니다.");
  }

  async function extractProductReferences() {
    setProductExtraction(null);
    setExtractionStatus("입력한 참고 자료에서 상품 중심 정보만 추출하는 중입니다.");
    const response = await fetch("/api/product-references/extract", {
      method: "POST",
      headers: {
        ...(await createTenantHeaders()),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        productImageUrl,
        homepageUrl,
        variantCount
      })
    });
    const body = (await response.json()) as ProductReferenceExtractResponse;
    if (!response.ok || !body.extraction) {
      setExtractionStatus(body.error?.code ?? `HTTP_${response.status}`);
      return;
    }
    setProductExtraction(body.extraction);
    const factCount = [
      body.extraction.productFacts.name,
      body.extraction.productFacts.brand,
      body.extraction.productFacts.title,
      body.extraction.productFacts.description,
      body.extraction.productFacts.image
    ].filter(Boolean).length;
    setExtractionStatus(
      `상품 정보 추출 완료: 사실 ${factCount}개, 이미지 후보 ${body.extraction.candidateImages.length}개가 준비됐습니다.`
    );
  }

  async function submitGenerationRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setApprovalId(null);
    setStatus("비용 가드를 확인하고 승인 요청을 준비하는 중입니다.");
    const response = await fetch("/api/cost/estimate", {
      method: "POST",
      headers: {
        ...(await createTenantHeaders()),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        operationType,
        units: variantCount,
        model: providerName,
        settings: {
          providerName
        },
        approvalRequest: {
          create: true,
          objectId: `creative-generation-${Date.now()}`,
          reason: `${rationale.approvalReason}\n\n요청 프롬프트: ${requestPrompt}`,
          generationContext: buildGenerationContext(requestPrompt, productReference, rationale)
        }
      })
    });
    const body = (await response.json()) as CostEstimateResponse;
    if (!response.ok) {
      setStatus(body.error?.code ?? `HTTP_${response.status}`);
      return;
    }
    setApprovalId(body.approval?.id ?? null);
    if (body.approval?.id) {
      window.dispatchEvent(new CustomEvent("hermes:approval-created", { detail: { approvalId: body.approval.id } }));
      window.location.hash = "approval-center";
      document.getElementById("approval-center")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    setStatus(
      body.approval?.id
        ? `승인 요청을 만들었습니다. 예상 비용은 ${formatKrw(body.estimatedCostKrw)}입니다.`
        : `비용 확인이 끝났습니다. 상태: ${body.status ?? "unknown"}.`
    );
  }

  return (
    <section className="creative-generation-panel" id="creative-generation">
      <div className="settings-hero">
        <div>
          <h2>광고 소재 생성</h2>
          <p>
            Hermes가 추천 브리프나 상품 참고 자료를 바탕으로 소재 생성 승인 요청을 만들고, 등록과 A/B 테스트는 PAUSED
            초안 및 승인 흐름 안에서 관리합니다.
          </p>
        </div>
        <div className="settings-context">
          <span>제공자 URL</span>
          <strong>{selectedProvider.endpointUrl || "사용자 지정 URL 필요"}</strong>
          <small>키는 서버 설정에 암호화되어 저장됩니다.</small>
        </div>
      </div>

      <form className="creative-request-card" onSubmit={submitGenerationRequest}>
        <div className="creative-analysis-card">
          <div className="section-title-row compact">
            <h3>
              <BarChart3 aria-hidden="true" size={18} />
              추천 기반 소재 방향
            </h3>
            <button className="reject-button slim" onClick={() => void loadCreativeContext()} type="button">
              <RefreshCw aria-hidden="true" size={14} />
              새로고침
            </button>
          </div>
          <div className="creative-rationale-grid">
            <RationaleBlock title="가장 좋은 신호" text={rationale.bestSignal} />
            <RationaleBlock title="유지할 요소" text={rationale.positiveReason} />
            <RationaleBlock title="개선할 요소" text={rationale.negativeReason} />
            <RationaleBlock title="생성 방향" text={rationale.generationDirection} />
          </div>
          <div className="creative-ops-plan">
            <RationaleBlock title="추천 프롬프트" text={requestPrompt} />
            <RationaleBlock title="상품 추출" text={rationale.productExtractionPlan} />
            <RationaleBlock title="등록 흐름" text={rationale.operationPlan} />
            <RationaleBlock title="A/B 테스트" text={rationale.abTestPlan} />
            <RationaleBlock title="자동화 경계" text={rationale.automationBoundary} />
          </div>
          <p className="muted">{analysisStatus}</p>
        </div>

        <div className="creative-mode-grid">
          <button
            className={`creative-mode ${operationType === "image_generation" ? "selected" : ""}`}
            onClick={() => setOperationType("image_generation")}
            type="button"
          >
            <ImagePlus aria-hidden="true" size={18} />
            <span>이미지 소재</span>
          </button>
          <button
            className={`creative-mode ${operationType === "video_generation" ? "selected" : ""}`}
            onClick={() => setOperationType("video_generation")}
            type="button"
          >
            <Video aria-hidden="true" size={18} />
            <span>영상 소재</span>
          </button>
        </div>

        <div className="settings-grid">
          <label className="field">
            <span>생성 제공자</span>
            <select value={providerName} onChange={(event) => setProviderName(event.target.value as ProviderName)}>
              {PROVIDERS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>생성 개수</span>
            <input
              max="6"
              min="1"
              onChange={(event) => setVariantCount(readVariantCount(event.target.value))}
              type="number"
              value={variantCount}
            />
          </label>
        </div>

        <div className="creative-reference-grid">
          <label className="field">
            <span>참고 상품 이미지 URL</span>
            <input
              onChange={(event) => setProductImageUrl(event.target.value)}
              placeholder="https://example.com/product-image.jpg"
              type="url"
              value={productImageUrl}
            />
          </label>
          <label className="field">
            <span>상품 홈페이지 URL</span>
            <input
              onChange={(event) => setHomepageUrl(event.target.value)}
              placeholder="https://example.com/product"
              type="url"
              value={homepageUrl}
            />
          </label>
        </div>

        <div className="creative-reference-actions">
          <button
            className="reject-button slim"
            disabled={!normalizeOptionalUrl(productImageUrl) && !normalizeOptionalUrl(homepageUrl)}
            onClick={() => void extractProductReferences()}
            type="button"
          >
            <Search aria-hidden="true" size={14} />
            상품 정보 추출
          </button>
          <span>{extractionStatus}</span>
        </div>

        <label className="field">
          <span>선택 입력 프롬프트</span>
          <textarea
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={rationale.recommendedPrompt}
            value={prompt}
          />
        </label>

        <div className="creative-actions">
          <button className="approve-button" disabled={!requestPrompt.trim()} type="submit">
            <WandSparkles aria-hidden="true" size={16} />
            {prompt.trim() ? "생성 승인 요청" : "추천안으로 승인 요청"}
          </button>
          {approvalId ? (
            <a className="meta-oauth-link secondary" href="#approval-center">
              <Send aria-hidden="true" size={16} />
              승인 센터로 이동
            </a>
          ) : null}
        </div>
        <p className="settings-message">{status}</p>
      </form>
    </section>
  );
}

function RationaleBlock({ title, text }: { title: string; text: string }) {
  return (
    <article className="rationale-block">
      <span>{title}</span>
      <p>{text}</p>
    </article>
  );
}

async function createTenantHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  const tenantId = readTenantId();
  if (tenantId) {
    headers["x-tenant-id"] = tenantId;
  }
  const supabase = createSupabaseBrowserClient();
  const session = await supabase?.auth.getSession();
  if (session?.data.session?.access_token) {
    headers.authorization = `Bearer ${session.data.session.access_token}`;
  }
  return headers;
}

function readTenantId(): string {
  try {
    return window.sessionStorage.getItem(TENANT_STORAGE_KEY) ?? window.localStorage.getItem(TENANT_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function formatKrw(value: number | undefined): string {
  return `${Math.round(value ?? 0).toLocaleString("ko-KR")} KRW`;
}

interface ProductReference {
  productImageUrl?: string;
  homepageUrl?: string;
  canonicalUrl?: string;
  productFacts?: ProductReferenceExtraction["productFacts"];
  candidateImages: string[];
  variantCount: number;
  instruction: string;
}

function buildCreativeRationale(
  summary: DashboardSummary | null,
  operationType: OperationType,
  prompt: string,
  productReference: ProductReference
) {
  const topAds = summary?.topAds ?? [];
  const recommendations = summary?.recommendations ?? [];
  const bestAd = [...topAds].sort((left, right) => {
    const leftScore = left.purchases * 10 + left.addToCart * 3 + left.ctr + Math.log10(left.spend + 1);
    const rightScore = right.purchases * 10 + right.addToCart * 3 + right.ctr + Math.log10(right.spend + 1);
    return rightScore - leftScore;
  })[0];
  const weakSignals = recommendations.filter((item) => item.severity === "high" || item.severity === "medium");
  const topWeakSignal = weakSignals[0] ?? recommendations[0];
  const operationLabel = operationType === "image_generation" ? "image" : "video";
  const fallbackPlan = fallbackOperationPlan(bestAd?.name);
  const operationPlan = topWeakSignal?.operationPlan ?? fallbackPlan;
  const recommendedPrompt =
    topWeakSignal?.creativeBrief?.recommendedPrompt ??
    `가장 성과가 좋은 기존 소재를 기준으로 Meta 광고 ${operationLabel === "image" ? "이미지" : "영상"} 변형을 생성하세요. 소재 각도 하나만 바꾸고 타겟, 랜딩 URL, 오퍼 사실, 캠페인 목적, 예산은 고정하세요. 안전영역 가이드나 라벨 없이 업로드 가능한 결과물로 만드세요.`;
  const recommendedPromptWithProduct =
    productReference.instruction.length > 0 ? `${recommendedPrompt} ${productReference.instruction}` : recommendedPrompt;

  const bestSignal = bestAd
    ? `${bestAd.name}이 가장 강한 참고 소재입니다. CTR ${bestAd.ctr.toFixed(2)}%, 구매 ${bestAd.purchases.toLocaleString("ko-KR")}건, 장바구니 ${bestAd.addToCart.toLocaleString("ko-KR")}건입니다.`
    : "비교 가능한 기존 소재 성과가 아직 없습니다. 자동화에 맡기기 전에 Meta 계정 데이터를 동기화하세요.";

  const positiveReason = bestAd
    ? `${bestAd.name}에서 검증된 오퍼 사실, 랜딩 URL, 타겟 맥락은 유지합니다.`
    : "Hermes가 충분한 성과 데이터를 확보할 때까지 브랜드와 오퍼 사실은 고정합니다.";

  const negativeReason = topWeakSignal
    ? `${translateAction(topWeakSignal.action)}: ${topWeakSignal.reason} 다음 단계: ${topWeakSignal.nextStep}`
    : "신뢰도 높은 병목 신호가 아직 없으므로 큰 폭의 소재 변경은 피합니다.";

  const generationDirection =
    prompt.trim().length > 0
      ? "입력한 프롬프트를 우선 사용하되, 추천 가드레일과 통제된 A/B 테스트 구조는 유지합니다."
      : productReference.instruction.length > 0
        ? `상품 참고 자료에서 상품만 분리해 ${productReference.variantCount}개의 통제된 ${operationLabel === "image" ? "이미지" : "영상"} 변형을 생성합니다.`
        : `추천 ${operationLabel === "image" ? "이미지" : "영상"} 브리프를 자동으로 사용합니다. 별도 프롬프트는 필요 없습니다.`;

  const operationPlanText = `${translateRegistrationMode(operationPlan.registrationMode)}: ${operationPlan.steps.join(" -> ")}`;
  const abTestPlan = `${operationPlan.abTest.control} 대 ${operationPlan.abTest.variant}; 핵심 지표 ${operationPlan.abTest.primaryMetric}; 최소 기준 ${operationPlan.abTest.minimumData}. ${operationPlan.abTest.stopCondition}`;
  const automationBoundary = [...operationPlan.automationBoundaries, operationPlan.approvalGate].join(" ");

  return {
    bestSignal,
    positiveReason,
    negativeReason,
    generationDirection,
    recommendedPrompt: recommendedPromptWithProduct,
    productExtractionPlan:
      productReference.instruction ||
      "참고 상품 이미지나 홈페이지 URL이 없습니다. 동기화된 Meta 소재 메타데이터와 기존 광고 성과만 사용합니다.",
    operationPlan: operationPlanText,
    abTestPlan,
    automationBoundary,
    approvalReason: [
      "추천 기반 광고 소재 생성 승인 요청",
      `성과 근거: ${bestSignal}`,
      `유지: ${positiveReason}`,
      `개선: ${negativeReason}`,
      `생성 방향: ${generationDirection}`,
      `상품 추출: ${
        productReference.instruction || "명시적인 상품 참고 자료가 없습니다. 동기화된 소재 메타데이터만 사용합니다."
      }`,
      `등록 메커니즘: ${operationPlanText}`,
      `A/B 테스트 계획: ${abTestPlan}`,
      `경계: ${automationBoundary}`
    ].join("\n")
  };
}

function buildProductReference(
  productImageUrl: string,
  homepageUrl: string,
  variantCount: number,
  extraction?: ProductReferenceExtraction | null
): ProductReference {
  const imageUrl = normalizeOptionalUrl(productImageUrl);
  const pageUrl = normalizeOptionalUrl(homepageUrl);
  if (extraction) {
    return {
      productImageUrl: extraction.sources.productImageUrl ?? imageUrl,
      homepageUrl: extraction.sources.homepageUrl ?? pageUrl,
      canonicalUrl: extraction.sources.canonicalUrl,
      productFacts: extraction.productFacts,
      candidateImages: extraction.candidateImages,
      variantCount: extraction.variantCount,
      instruction: extraction.generationInstruction
    };
  }
  const sourceParts = [
    imageUrl ? `참고 상품 이미지: ${imageUrl}` : "",
    pageUrl ? `상품 홈페이지: ${pageUrl}` : ""
  ].filter(Boolean);
  const instruction =
    sourceParts.length > 0
      ? [
          `${sourceParts.join("; ")}를 사용합니다.`,
          "상품만 주 피사체로 추출하고, 관련 없는 페이지 배경, 배너, 인물, 리뷰, 내비게이션은 복사하지 않습니다.",
          "홈페이지에서 확인 가능한 상품 사실만 유지하고 할인, 보증, 배송, 의료/금융성 문구는 새로 만들지 않습니다.",
          `상품 정체성, 오퍼 사실, 타겟, 랜딩 URL, 캠페인 목적, 예산은 고정한 채 변형마다 소재 변수 하나만 바꿔 ${variantCount}개의 다양한 변형을 생성합니다.`
        ].join(" ")
      : "";
  return {
    productImageUrl: imageUrl,
    homepageUrl: pageUrl,
    candidateImages: imageUrl ? [imageUrl] : [],
    variantCount,
    instruction
  };
}

function buildGenerationContext(
  requestPrompt: string,
  productReference: ProductReference,
  rationale: ReturnType<typeof buildCreativeRationale>
) {
  return {
    prompt: requestPrompt,
    variantCount: productReference.variantCount,
    productReference: {
      sources: {
        productImageUrl: productReference.productImageUrl,
        homepageUrl: productReference.homepageUrl,
        canonicalUrl: productReference.canonicalUrl
      },
      productFacts: productReference.productFacts,
      candidateImages: productReference.candidateImages,
      variantCount: productReference.variantCount,
      generationInstruction: productReference.instruction,
      extractionPolicy: {
        mode: "product_only",
        rawHtmlStored: false,
        javascriptExecuted: false,
        generatedClaimsAllowed: false
      }
    },
    experimentPlan: {
      mode: "controlled_ab_test",
      changedVariable: "단일 소재 각도",
      control: "현재 가장 유사한 우수 광고",
      primaryMetric: "CTR",
      secondaryMetrics: ["CTR", "랜딩 도착률", "장바구니 전환율", "구매 전환율"],
      minimumData: rationale.abTestPlan,
      stopCondition: "최소 신호가 쌓이기 전이나 정책/비용 가드가 막는 동안에는 승자를 확정하지 않습니다.",
      registrationMode: "paused_draft_after_qa"
    },
    draftRegistration: {
      mode: "paused_draft_after_qa",
      requiresDraftApproval: true,
      route: "/api/drafts/create-paused"
    }
  };
}

function normalizeOptionalUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function readVariantCount(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 3;
  }
  return Math.min(6, Math.max(1, Math.round(parsed)));
}

function fallbackOperationPlan(control?: string): OperationPlan {
  return {
    registrationMode: "paused_draft_after_qa",
    approvalGate:
      "유료 AI 승인 후에만 소재를 생성하고, Meta 광고는 PAUSED 초안으로만 등록합니다. ACTIVE 전환은 별도 승인이 필요합니다.",
    steps: [
      "추천 브리프에서 업로드 가능한 소재를 생성합니다.",
      "안전영역, 가격 정확성, 금지 문구, 게재 위치 호환성을 검사합니다.",
      "검증 후 PAUSED 상태의 Meta 초안을 만듭니다.",
      "초안을 승인 센터로 보냅니다.",
      "성과를 모니터링하되 예산 변경은 추천으로만 유지합니다."
    ],
    abTest: {
      control: control ?? "현재 가장 유사한 우수 광고",
      variant: "단일 소재 각도 변형",
      primaryMetric: "CTR",
      secondaryMetrics: ["CTR", "랜딩 도착률", "장바구니 전환율", "구매 전환율"],
      minimumData: "노출 1,500 이상, 링크 클릭 50 이상, 랜딩 페이지 조회 30 이상",
      stopCondition: "최소 신호가 쌓이기 전이나 정책/비용 가드가 막는 동안에는 승자를 확정하지 않습니다."
    },
    automationBoundaries: [
      "예산 변경 API는 사용할 수 없습니다.",
      "명시적 승인 없이 ACTIVE 전환은 실행하지 않습니다.",
      "필수 승인 정책 없이 파괴적 작업은 실행하지 않습니다."
    ]
  };
}

function translateAction(action: string): string {
  const labels: Record<string, string> = {
    observe_until_signal: "신호가 쌓일 때까지 관찰",
    continue_observation: "관찰 계속",
    creative_hook_test: "소재 훅 테스트",
    landing_arrival_diagnostic: "랜딩 도착 진단",
    fatigue_creative_refresh: "소재 피로도 리프레시",
    offer_or_product_page_review: "오퍼 또는 상품 페이지 점검",
    creative_metadata_resync: "소재 메타데이터 재동기화",
    meta_account_backfill_required: "Meta 계정 백필 필요"
  };
  return labels[action] ?? action;
}

function translateRegistrationMode(mode: OperationPlan["registrationMode"]): string {
  return mode === "paused_draft_after_qa" ? "QA 후 PAUSED 초안 등록" : mode;
}
