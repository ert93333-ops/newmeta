"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Activity, AlertTriangle, BarChart3, CheckCircle2, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const TENANT_STORAGE_KEY = "hermes:tenant-id";

interface DashboardSummary {
  counts?: {
    accounts: number;
    campaigns: number;
    adsets: number;
    ads: number;
    activeAds: number;
    pausedAds: number;
    adsWithCreativeMetadata: number;
    insightRows: number;
  };
  totals?: {
    spend: number;
    impressions: number;
    clicks: number;
    linkClicks: number;
    landingPageViews: number;
    purchases: number;
    addToCart: number;
    ctr: number;
    landingRate: number;
    purchaseRate: number;
  };
  topAds?: Array<{
    adId?: string;
    metaAdId?: string;
    name: string;
    status: string;
    spend: number;
    impressions: number;
    purchases: number;
    addToCart: number;
    ctr: number;
    cpc: number;
    cpm: number;
    purchaseRoas: number;
    creativeReady: boolean;
  }>;
  recommendations?: Array<{
    severity: "observe" | "low" | "medium" | "high";
    action: string;
    reason: string;
    nextStep: string;
    confidence: string;
    adName?: string;
    metaAdId?: string;
  }>;
  warnings?: Array<{
    source: string;
    code: string;
  }>;
  safety?: {
    budgetChangesExecutable: boolean;
    activationRequiresApproval: boolean;
    customerTokensServerOnly: boolean;
  };
  error?: {
    code?: string;
  };
}

type LoadState = "idle" | "loading" | "ready" | "blocked";

export function DashboardPanel() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [state, setState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadSummary();
  }, []);

  async function loadSummary() {
    setState("loading");
    setError(null);
    const headers = await createTenantHeaders();
    if (!headers.authorization && !headers["x-tenant-id"]) {
      setSummary(null);
      setState("blocked");
      setError("LOGIN_REQUIRED");
      return;
    }
    const response = await fetch("/api/dashboard/summary", {
      headers
    });
    const body = (await response.json()) as DashboardSummary;
    if (!response.ok) {
      setSummary(null);
      setState("blocked");
      setError(body.error?.code ?? `HTTP_${response.status}`);
      return;
    }
    setSummary(body);
    setState("ready");
  }

  const counts = summary?.counts;
  const totals = summary?.totals;
  const topAds = summary?.topAds ?? [];
  const recommendations = summary?.recommendations ?? [];
  const maxSpend = useMemo(() => Math.max(...topAds.map((ad) => ad.spend), 1), [topAds]);

  return (
    <section className="dashboard-panel" id="dashboard">
      <div className="dashboard-header">
        <div>
          <h1>광고 운영 대시보드</h1>
          <p>Meta에서 가져온 기존 광고 소재와 성과를 기준으로 오늘 봐야 할 병목, 소재 상태, 자동운영 추천을 먼저 보여줍니다.</p>
        </div>
        <button className="approve-button dashboard-refresh" onClick={() => void loadSummary()} type="button">
          <RefreshCw aria-hidden="true" size={16} />
          새로고침
        </button>
      </div>

      {state === "blocked" ? (
        <div className="dashboard-error">
          <AlertTriangle aria-hidden="true" size={18} />
          <span>대시보드를 불러오지 못했습니다: {error}</span>
        </div>
      ) : null}

      {summary?.warnings?.length ? (
        <div className="dashboard-error soft">
          <AlertTriangle aria-hidden="true" size={18} />
          <span>
            일부 데이터 소스를 불러오지 못했습니다:{" "}
            {summary.warnings.map((warning) => `${warning.source}/${warning.code}`).join(", ")}
          </span>
        </div>
      ) : null}

      <div className="dashboard-kpis">
        <MetricCard icon={<BarChart3 size={18} />} label="총 지출" value={formatKrw(totals?.spend)} detail={`${formatNumber(totals?.impressions)} 노출`} />
        <MetricCard icon={<Activity size={18} />} label="CTR" value={`${formatFixed(totals?.ctr)}%`} detail={`${formatNumber(totals?.clicks)} 클릭`} />
        <MetricCard icon={<CheckCircle2 size={18} />} label="구매/장바구니" value={`${formatNumber(totals?.purchases)} / ${formatNumber(totals?.addToCart)}`} detail={`랜딩률 ${formatFixed(totals?.landingRate)}%`} />
        <MetricCard icon={<Sparkles size={18} />} label="소재 확보" value={`${formatNumber(counts?.adsWithCreativeMetadata)} / ${formatNumber(counts?.ads)}`} detail="광고 소재 메타데이터" />
      </div>

      <div className="dashboard-layout">
        <section className="dashboard-main-card">
          <div className="section-title-row">
            <div>
              <h2>광고별 성과</h2>
              <p>지출 기준 상위 광고와 소재 준비 상태입니다.</p>
            </div>
            <span className="tag good">{formatNumber(counts?.insightRows)}개 스냅샷</span>
          </div>
          <div className="ad-performance-list">
            {topAds.length > 0 ? (
              topAds.map((ad) => (
                <div className="ad-performance-row" key={ad.adId ?? ad.metaAdId ?? ad.name}>
                  <div className="ad-row-title">
                    <strong>{ad.name}</strong>
                    <span>{ad.metaAdId ?? "Meta ID 없음"}</span>
                  </div>
                  <div className="ad-row-bar" aria-hidden="true">
                    <span style={{ width: `${Math.max(4, (ad.spend / maxSpend) * 100)}%` }} />
                  </div>
                  <div className="ad-row-metrics">
                    <span>{formatKrw(ad.spend)}</span>
                    <span>CTR {formatFixed(ad.ctr)}%</span>
                    <span>구매 {formatNumber(ad.purchases)}</span>
                    <span className={ad.creativeReady ? "good-text" : "warn-text"}>{ad.creativeReady ? "소재 확인됨" : "소재 필요"}</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="empty-state">아직 동기화된 광고 성과가 없습니다. 설정에서 Meta 연결 후 백필을 실행하십시오.</div>
            )}
          </div>
        </section>

        <aside className="dashboard-side">
          <section className="dashboard-main-card">
            <div className="section-title-row compact">
              <h2>자동운영 추천</h2>
              <span className="tag warn">읽기 전용</span>
            </div>
            <div className="recommendation-list">
              {recommendations.length > 0 ? (
                recommendations.map((item, index) => (
                  <article className={`recommendation ${item.severity}`} key={`${item.action}-${index}`}>
                    <strong>{translateAction(item.action)}</strong>
                    <p>{item.reason}</p>
                    <small>{item.nextStep}</small>
                  </article>
                ))
              ) : (
                <div className="empty-state">추천을 만들 데이터가 아직 부족합니다.</div>
              )}
            </div>
          </section>

          <section className="dashboard-main-card">
            <div className="section-title-row compact">
              <h2>운영 안전장치</h2>
              <ShieldCheck aria-hidden="true" size={18} />
            </div>
            <div className="safety-list">
              <SafetyRow label="예산 변경 실행" ok={summary?.safety?.budgetChangesExecutable === false} value="하드 차단" />
              <SafetyRow label="광고 개시/상태 변경" ok={summary?.safety?.activationRequiresApproval === true} value="승인 필요" />
              <SafetyRow label="고객 Meta 토큰" ok={summary?.safety?.customerTokensServerOnly === true} value="서버 전용" />
              <SafetyRow label="광고 계정" ok={Boolean(counts?.accounts)} value={`${formatNumber(counts?.accounts)}개`} />
            </div>
          </section>
        </aside>
      </div>
    </section>
  );
}

function MetricCard({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail: string }) {
  return (
    <article className="metric-card">
      <div className="metric-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function SafetyRow({ label, ok, value }: { label: string; ok: boolean; value: string }) {
  return (
    <div className="safety-row">
      <span>{label}</span>
      <strong className={ok ? "good-text" : "warn-text"}>{value}</strong>
    </div>
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

function formatNumber(value: number | undefined): string {
  return Math.round(value ?? 0).toLocaleString("ko-KR");
}

function formatFixed(value: number | undefined): string {
  return (value ?? 0).toFixed(2);
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
