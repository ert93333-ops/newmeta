"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { BarChart3, ImagePlus, RefreshCw, Send, Video, WandSparkles } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const TENANT_STORAGE_KEY = "hermes:tenant-id";

const PROVIDERS = [
  { value: "openai", label: "OpenAI", endpointUrl: "https://api.openai.com/v1" },
  { value: "anthropic", label: "Claude / Anthropic", endpointUrl: "https://api.anthropic.com/v1" },
  { value: "higgsfield", label: "Higgsfield", endpointUrl: "https://api.higgsfield.ai/v1" },
  { value: "generic_http", label: "Generic HTTPS", endpointUrl: "" }
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

export function CreativeGenerationPanel() {
  const [operationType, setOperationType] = useState<OperationType>("image_generation");
  const [providerName, setProviderName] = useState<ProviderName>(PROVIDERS[0].value);
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState("요청 대기");
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState("기존 광고 소재 성과를 불러오는 중입니다.");
  const selectedProvider = PROVIDERS.find((item) => item.value === providerName) ?? PROVIDERS[0];
  const rationale = useMemo(() => buildCreativeRationale(summary, operationType, prompt), [summary, operationType, prompt]);

  useEffect(() => {
    void loadCreativeContext();
  }, []);

  async function loadCreativeContext() {
    const headers = await createTenantHeaders();
    if (!headers.authorization && !headers["x-tenant-id"]) {
      setAnalysisStatus("로그인 후 기존 광고 소재 분석을 불러올 수 있습니다.");
      return;
    }
    const response = await fetch("/api/dashboard/summary", { headers });
    const body = (await response.json()) as DashboardSummary;
    if (!response.ok) {
      setAnalysisStatus(body.error?.code ?? `HTTP_${response.status}`);
      return;
    }
    setSummary(body);
    setAnalysisStatus("기존 광고 소재 성과 분석을 반영했습니다.");
  }

  async function submitGenerationRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setApprovalId(null);
    setStatus("비용 가드와 승인 요청을 확인하는 중입니다.");
    const response = await fetch("/api/cost/estimate", {
      method: "POST",
      headers: {
        ...(await createTenantHeaders()),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        operationType,
        units: 1,
        model: providerName,
        settings: {
          providerName
        },
        approvalRequest: {
          create: true,
          objectId: `creative-generation-${Date.now()}`,
          reason: `${rationale.approvalReason}\n\n요청 프롬프트: ${prompt.trim()}`
        }
      })
    });
    const body = (await response.json()) as CostEstimateResponse;
    if (!response.ok) {
      setStatus(body.error?.code ?? `HTTP_${response.status}`);
      return;
    }
    setApprovalId(body.approval?.id ?? null);
    setStatus(
      body.approval?.id
        ? `승인 요청 생성됨. 예상 비용 ${formatKrw(body.estimatedCostKrw)}`
        : `비용 확인 완료. 상태 ${body.status ?? "unknown"}`
    );
  }

  return (
    <section className="creative-generation-panel" id="creative-generation">
      <div className="settings-hero">
        <div>
          <h2>소재 생성</h2>
          <p>광고 소재 생성 요청을 만들고 비용 승인부터 진행합니다. 승인 전에는 유료 생성 job이 큐에 들어가지 않습니다.</p>
        </div>
        <div className="settings-context">
          <span>Provider URL</span>
          <strong>{selectedProvider.endpointUrl || "커스텀 URL 필요"}</strong>
          <small>API 키는 설정에서 암호화 저장</small>
        </div>
      </div>

      <form className="creative-request-card" onSubmit={submitGenerationRequest}>
        <div className="creative-analysis-card">
          <div className="section-title-row compact">
            <h3>
              <BarChart3 aria-hidden="true" size={18} />
              기존 소재 분석 기반 생성 방향
            </h3>
            <button className="reject-button slim" onClick={() => void loadCreativeContext()} type="button">
              <RefreshCw aria-hidden="true" size={14} />
              다시 분석
            </button>
          </div>
          <div className="creative-rationale-grid">
            <RationaleBlock title="성과가 좋았던 소재" text={rationale.bestSignal} />
            <RationaleBlock title="좋았던 부분" text={rationale.positiveReason} />
            <RationaleBlock title="나빴던 부분" text={rationale.negativeReason} />
            <RationaleBlock title="생성할 소재 방향" text={rationale.generationDirection} />
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
            <span>Provider</span>
            <select value={providerName} onChange={(event) => setProviderName(event.target.value as ProviderName)}>
              {PROVIDERS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>생성 단위</span>
            <input disabled value="1" />
          </label>
        </div>

        <label className="field">
          <span>프롬프트</span>
          <textarea
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="예: 기존 우수 소재 톤을 유지하되 첫 3초 hook을 더 강하게 만든 Meta 피드용 이미지 소재"
            value={prompt}
          />
        </label>

        <div className="creative-actions">
          <button className="approve-button" disabled={!prompt.trim()} type="submit">
            <WandSparkles aria-hidden="true" size={16} />
            생성 승인 요청
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
  return `${Math.round(value ?? 0).toLocaleString("ko-KR")}원`;
}

function buildCreativeRationale(summary: DashboardSummary | null, operationType: OperationType, prompt: string) {
  const topAds = summary?.topAds ?? [];
  const recommendations = summary?.recommendations ?? [];
  const bestAd = [...topAds].sort((left, right) => {
    const leftScore = left.purchases * 10 + left.addToCart * 3 + left.ctr + Math.log10(left.spend + 1);
    const rightScore = right.purchases * 10 + right.addToCart * 3 + right.ctr + Math.log10(right.spend + 1);
    return rightScore - leftScore;
  })[0];
  const weakSignals = recommendations.filter((item) => item.severity === "high" || item.severity === "medium");
  const topWeakSignal = weakSignals[0] ?? recommendations[0];
  const operationLabel = operationType === "image_generation" ? "이미지" : "영상";

  const bestSignal = bestAd
    ? `${bestAd.name}는 CTR ${bestAd.ctr.toFixed(2)}%, 구매 ${bestAd.purchases.toLocaleString("ko-KR")}건, 장바구니 ${bestAd.addToCart.toLocaleString("ko-KR")}건으로 현재 후보 중 가장 참고 가치가 큽니다.`
    : "아직 비교 가능한 기존 광고 소재 성과가 부족합니다. 먼저 Meta 백필 후 생성 근거를 강화해야 합니다.";

  const positiveReason = bestAd
    ? `지출 ${formatKrw(bestAd.spend)}와 노출 ${bestAd.impressions.toLocaleString("ko-KR")}건 기준으로 반응 신호가 확인되어, 메시지 톤/오퍼 구조/시각적 hook을 새 소재의 기준점으로 삼습니다.`
    : "우수 소재 신호가 없으므로 기존 브랜드 톤을 유지하되, 첫 화면 주목도와 오퍼 명확성을 우선 검증합니다.";

  const negativeReason = topWeakSignal
    ? `${translateAction(topWeakSignal.action)}: ${topWeakSignal.reason} 개선 방향은 ${topWeakSignal.nextStep}`
    : "현재 명확한 고위험 병목은 없지만, 소재 메타데이터와 전환 신호가 충분하지 않아 과감한 자동 변경은 보류합니다.";

  const generationDirection =
    prompt.trim().length > 0
      ? `${operationLabel} 소재는 사용자가 입력한 프롬프트를 따르되, 위 우수 소재의 반응 요소를 유지하고 약한 신호를 보완하는 방향으로 생성합니다.`
      : `${operationLabel} 소재는 우수 소재의 hook과 오퍼 명확성을 유지하면서 CTR/랜딩/전환 병목을 줄이는 변형으로 생성해야 합니다.`;

  return {
    bestSignal,
    positiveReason,
    negativeReason,
    generationDirection,
    approvalReason: [
      "기존 광고 소재 분석 기반 생성 승인 요청",
      `성과 근거: ${bestSignal}`,
      `좋았던 부분: ${positiveReason}`,
      `나빴던 부분: ${negativeReason}`,
      `생성 방향: ${generationDirection}`
    ].join("\n")
  };
}

function translateAction(action: string): string {
  const labels: Record<string, string> = {
    observe_until_signal: "데이터 추가 관찰",
    continue_observation: "관찰 유지",
    creative_hook_test: "소재 Hook 테스트",
    landing_arrival_diagnostic: "랜딩 도달 진단",
    fatigue_creative_refresh: "피로도 소재 교체",
    offer_or_product_page_review: "오퍼/상세페이지 점검",
    creative_metadata_resync: "소재 메타데이터 재동기화",
    meta_account_backfill_required: "Meta 백필 필요"
  };
  return labels[action] ?? action;
}
