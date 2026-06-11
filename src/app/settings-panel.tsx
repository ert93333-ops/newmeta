"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { RefreshCw, Save, SlidersHorizontal } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type SettingsStatus = "idle" | "loading" | "ready" | "blocked" | "saving" | "saved";

type TenantMembership = {
  tenantId: string;
  name: string;
  role: string;
};

type MeResponse = {
  memberships?: TenantMembership[];
  activeTenant?: TenantMembership | null;
};

type IntegrationSettingsRecord = {
  id?: string;
  provider: string;
  tenantId: string;
  settingsJson?: Record<string, unknown> | null;
  updatedAt?: string;
};

type SettingsResponse = {
  provider?: string;
  configured?: boolean;
  setting?: IntegrationSettingsRecord | null;
  error?: {
    code?: string;
  };
};

type CostSettingsFormState = {
  providerName: string;
  planName: string;
  monthlyPlanPriceKrw: string;
  monthlyCredits: string;
  creditUnitCostKrw: string;
  imageGenerationCreditCost: string;
  videoGenerationCreditCost: string;
  analysisCreditCost: string;
  dailyCostCapKrw: string;
  monthlyCostCapKrw: string;
  hardDailyCapKrw: string;
  referenceDailyAdBudgetKrw: string;
};

const TENANT_STORAGE_KEY = "hermes:tenant-id";
const ROLE_RANK: Record<string, number> = {
  owner: 5,
  admin: 4,
  marketer: 3,
  analyst: 2,
  viewer: 1
};

const DEFAULT_FORM: CostSettingsFormState = {
  providerName: "mock-ai",
  planName: "",
  monthlyPlanPriceKrw: "",
  monthlyCredits: "",
  creditUnitCostKrw: "100",
  imageGenerationCreditCost: "5",
  videoGenerationCreditCost: "30",
  analysisCreditCost: "1",
  dailyCostCapKrw: "5000",
  monthlyCostCapKrw: "",
  hardDailyCapKrw: "7500",
  referenceDailyAdBudgetKrw: "50000"
};

export function SettingsPanel() {
  const [form, setForm] = useState<CostSettingsFormState>(DEFAULT_FORM);
  const [status, setStatus] = useState<SettingsStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<TenantMembership[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [configured, setConfigured] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [activeRole, setActiveRole] = useState<string | null>(null);

  useEffect(() => {
    const storedTenantId = readTenantId();
    setTenantId(storedTenantId);
    void initialize(storedTenantId);
  }, []);

  const canSave = activeRole ? (ROLE_RANK[activeRole] ?? 0) >= ROLE_RANK.marketer : true;
  const statusTone = status === "blocked" ? "blocked" : status === "saved" || status === "ready" ? "ready" : "pending";
  const formSummary = useMemo(
    () => [
      { label: "일일 한도", value: form.dailyCostCapKrw || "미설정" },
      { label: "하드 한도", value: form.hardDailyCapKrw || "미설정" },
      { label: "이미지 비용", value: form.imageGenerationCreditCost || "미설정" },
      { label: "비디오 비용", value: form.videoGenerationCreditCost || "미설정" }
    ],
    [form]
  );

  async function initialize(storedTenantId: string) {
    const nextContext = await loadMembershipContext(storedTenantId);
    setMemberships(nextContext.memberships);
    setActiveRole(nextContext.role ?? null);
    if (nextContext.tenantId && nextContext.tenantId !== storedTenantId) {
      persistTenantId(nextContext.tenantId);
      setTenantId(nextContext.tenantId);
    }
    await loadSettings(nextContext.providerName ?? form.providerName, nextContext.tenantId ?? storedTenantId);
  }

  async function loadSettings(providerName: string, explicitTenantId?: string) {
    const normalizedProvider = providerName.trim();
    if (!normalizedProvider) {
      setStatus("blocked");
      setError("COST_PROVIDER_REQUIRED");
      return;
    }

    setStatus("loading");
    setError(null);
    const headers = await createTenantHeaders(explicitTenantId);
    const response = await fetch(`/api/settings/${encodeURIComponent(normalizedProvider)}`, {
      method: "GET",
      headers
    });
    const body = (await response.json()) as SettingsResponse;

    if (!response.ok) {
      setStatus("blocked");
      setError(body.error?.code ?? `HTTP_${response.status}`);
      return;
    }

    setConfigured(Boolean(body.configured));
    setUpdatedAt(body.setting?.updatedAt ?? null);
    setForm((current) => mergeFormState(current, normalizedProvider, body.setting?.settingsJson));
    setStatus("ready");
  }

  async function handleLoad(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    await loadSettings(form.providerName, tenantId);
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave) {
      setStatus("blocked");
      setError("ROLE_ACCESS_DENIED");
      return;
    }

    const providerName = form.providerName.trim();
    if (!providerName) {
      setStatus("blocked");
      setError("COST_PROVIDER_REQUIRED");
      return;
    }

    setStatus("saving");
    setError(null);
    const headers = {
      ...(await createTenantHeaders()),
      "Content-Type": "application/json"
    };
    const response = await fetch(`/api/settings/${encodeURIComponent(providerName)}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(toSettingsPayload(form))
    });
    const body = (await response.json()) as SettingsResponse & {
      setting?: IntegrationSettingsRecord | null;
    };

    if (!response.ok) {
      setStatus("blocked");
      setError(body.error?.code ?? `HTTP_${response.status}`);
      return;
    }

    setConfigured(true);
    setUpdatedAt(body.setting?.updatedAt ?? null);
    setStatus("saved");
  }

  return (
    <section className="panel settings-panel" id="settings">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">
            <SlidersHorizontal aria-hidden="true" size={14} />
            설정
          </p>
          <h2>서버 소유 비용 가드 설정</h2>
          <p className="muted">프로바이더 가격과 한도는 테넌트별로 저장되며 비용 추정 API에서 사용됩니다.</p>
        </div>
        <span className={`tag ${configured ? "good" : "warn"}`}>{configured ? "설정됨" : "설정 필요"}</span>
      </div>

      <div className="settings-layout">
        <form className="settings-form" onSubmit={handleSave}>
          <div className="settings-toolbar">
            <label className="field">
              <span>프로바이더 키</span>
              <input
                autoComplete="off"
                onChange={(event) => setForm((current) => ({ ...current, providerName: event.target.value }))}
                placeholder="mock-ai"
                value={form.providerName}
              />
            </label>
            <button className="reject-button settings-refresh" onClick={() => void handleLoad()} type="button">
              <RefreshCw aria-hidden="true" size={16} />
              불러오기
            </button>
          </div>

          <div className="settings-grid">
            <label className="field">
              <span>요금제 이름</span>
              <input
                autoComplete="off"
                onChange={(event) => setForm((current) => ({ ...current, planName: event.target.value }))}
                placeholder="Starter"
                value={form.planName}
              />
            </label>
            <label className="field">
              <span>크레딧 단가 (KRW)</span>
              <input
                inputMode="decimal"
                onChange={(event) => setForm((current) => ({ ...current, creditUnitCostKrw: event.target.value }))}
                value={form.creditUnitCostKrw}
              />
            </label>
            <label className="field">
              <span>월 요금제 가격 (KRW)</span>
              <input
                inputMode="decimal"
                onChange={(event) => setForm((current) => ({ ...current, monthlyPlanPriceKrw: event.target.value }))}
                value={form.monthlyPlanPriceKrw}
              />
            </label>
            <label className="field">
              <span>월 크레딧</span>
              <input
                inputMode="decimal"
                onChange={(event) => setForm((current) => ({ ...current, monthlyCredits: event.target.value }))}
                value={form.monthlyCredits}
              />
            </label>
            <label className="field">
              <span>이미지 생성 크레딧</span>
              <input
                inputMode="decimal"
                onChange={(event) => setForm((current) => ({ ...current, imageGenerationCreditCost: event.target.value }))}
                value={form.imageGenerationCreditCost}
              />
            </label>
            <label className="field">
              <span>비디오 생성 크레딧</span>
              <input
                inputMode="decimal"
                onChange={(event) => setForm((current) => ({ ...current, videoGenerationCreditCost: event.target.value }))}
                value={form.videoGenerationCreditCost}
              />
            </label>
            <label className="field">
              <span>분석 크레딧</span>
              <input
                inputMode="decimal"
                onChange={(event) => setForm((current) => ({ ...current, analysisCreditCost: event.target.value }))}
                value={form.analysisCreditCost}
              />
            </label>
            <label className="field">
              <span>일일 한도 (KRW)</span>
              <input
                inputMode="decimal"
                onChange={(event) => setForm((current) => ({ ...current, dailyCostCapKrw: event.target.value }))}
                value={form.dailyCostCapKrw}
              />
            </label>
            <label className="field">
              <span>일일 하드 한도 (KRW)</span>
              <input
                inputMode="decimal"
                onChange={(event) => setForm((current) => ({ ...current, hardDailyCapKrw: event.target.value }))}
                value={form.hardDailyCapKrw}
              />
            </label>
            <label className="field">
              <span>월 한도 (KRW)</span>
              <input
                inputMode="decimal"
                onChange={(event) => setForm((current) => ({ ...current, monthlyCostCapKrw: event.target.value }))}
                value={form.monthlyCostCapKrw}
              />
            </label>
            <label className="field">
              <span>참고 광고 예산 (KRW/일)</span>
              <input
                inputMode="decimal"
                onChange={(event) => setForm((current) => ({ ...current, referenceDailyAdBudgetKrw: event.target.value }))}
                value={form.referenceDailyAdBudgetKrw}
              />
            </label>
          </div>

          <div className={`guard-state ${statusTone}`} role="status">
            <span>{getSettingsStatusMessage(status, error, activeRole)}</span>
          </div>

          <div className="settings-actions">
            <button className="approve-button" disabled={status === "saving" || status === "loading" || !canSave} type="submit">
              <Save aria-hidden="true" size={16} />
              설정 저장
            </button>
          </div>
        </form>

        <div className="settings-summary">
          <div className="settings-summary-head">
            <strong>서버 상태</strong>
            <small>{updatedAt ? `업데이트 ${formatDate(updatedAt)}` : "아직 저장된 행 없음"}</small>
          </div>
          <div className="checks settings-checks">
            {formSummary.map((item) => (
              <div className="check-row" key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
          <div className="settings-note">
            <span>테넌트</span>
            <strong>{tenantId || memberships[0]?.tenantId || "mock-default"}</strong>
            <span>역할</span>
            <strong>{activeRole ?? "mock-owner"}</strong>
            <span>추정 API</span>
            <strong>{configured ? "프로바이더 행 확인 가능" : "저장 전까지 차단"}</strong>
          </div>
        </div>
      </div>
    </section>
  );
}

function mergeFormState(
  current: CostSettingsFormState,
  providerName: string,
  settingsJson: Record<string, unknown> | null | undefined
): CostSettingsFormState {
  if (!settingsJson) {
    return {
      ...DEFAULT_FORM,
      providerName
    };
  }

  return {
    providerName,
    planName: readStringValue(settingsJson.planName),
    monthlyPlanPriceKrw: readNumberValue(settingsJson.monthlyPlanPriceKrw),
    monthlyCredits: readNumberValue(settingsJson.monthlyCredits),
    creditUnitCostKrw: readNumberValue(settingsJson.creditUnitCostKrw),
    imageGenerationCreditCost: readNumberValue(settingsJson.imageGenerationCreditCost),
    videoGenerationCreditCost: readNumberValue(settingsJson.videoGenerationCreditCost),
    analysisCreditCost: readNumberValue(settingsJson.analysisCreditCost),
    dailyCostCapKrw: readNumberValue(settingsJson.dailyCostCapKrw),
    monthlyCostCapKrw: readNumberValue(settingsJson.monthlyCostCapKrw),
    hardDailyCapKrw: readNumberValue(settingsJson.hardDailyCapKrw),
    referenceDailyAdBudgetKrw: readNumberValue(settingsJson.referenceDailyAdBudgetKrw)
  };
}

function toSettingsPayload(form: CostSettingsFormState): Record<string, unknown> {
  return {
    providerName: form.providerName.trim(),
    planName: readOptionalString(form.planName),
    monthlyPlanPriceKrw: readOptionalNumber(form.monthlyPlanPriceKrw),
    monthlyCredits: readOptionalNumber(form.monthlyCredits),
    creditUnitCostKrw: readOptionalNumber(form.creditUnitCostKrw),
    imageGenerationCreditCost: readOptionalNumber(form.imageGenerationCreditCost),
    videoGenerationCreditCost: readOptionalNumber(form.videoGenerationCreditCost),
    analysisCreditCost: readOptionalNumber(form.analysisCreditCost),
    dailyCostCapKrw: readOptionalNumber(form.dailyCostCapKrw),
    monthlyCostCapKrw: readOptionalNumber(form.monthlyCostCapKrw),
    hardDailyCapKrw: readOptionalNumber(form.hardDailyCapKrw),
    referenceDailyAdBudgetKrw: readOptionalNumber(form.referenceDailyAdBudgetKrw)
  };
}

function readTenantId(): string {
  try {
    return window.sessionStorage.getItem(TENANT_STORAGE_KEY) ?? window.localStorage.getItem(TENANT_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function persistTenantId(tenantId: string): void {
  try {
    window.sessionStorage.setItem(TENANT_STORAGE_KEY, tenantId);
    window.localStorage.setItem(TENANT_STORAGE_KEY, tenantId);
  } catch {
    // Storage can be disabled; requests still use mock/default tenant behavior.
  }
}

async function createTenantHeaders(explicitTenantId?: string): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  const tenantId = explicitTenantId ?? readTenantId();
  if (tenantId) {
    headers["x-tenant-id"] = tenantId;
  }
  const bearer = await getSupabaseBearer();
  if (bearer) {
    headers.authorization = `Bearer ${bearer}`;
  }
  return headers;
}

async function getSupabaseBearer(): Promise<string | undefined> {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) {
    return undefined;
  }
  const session = await supabase.auth.getSession();
  return session.data.session?.access_token;
}

async function loadMembershipContext(storedTenantId: string): Promise<{
  tenantId?: string;
  role?: string;
  memberships: TenantMembership[];
  providerName?: string;
}> {
  const bearer = await getSupabaseBearer();
  if (!bearer) {
    return {
      tenantId: storedTenantId || undefined,
      memberships: []
    };
  }

  try {
    const response = await fetch("/api/me", {
      headers: {
        authorization: `Bearer ${bearer}`
      }
    });
    const body = (await response.json()) as MeResponse;
    if (!response.ok) {
      return {
        tenantId: storedTenantId || undefined,
        memberships: []
      };
    }

    const memberships = body.memberships ?? [];
    const preferredTenant =
      memberships.find((membership) => membership.tenantId === storedTenantId) ??
      body.activeTenant ??
      memberships[0];

    return {
      tenantId: preferredTenant?.tenantId,
      role: preferredTenant?.role,
      memberships
    };
  } catch {
    return {
      tenantId: storedTenantId || undefined,
      memberships: []
    };
  }
}

function getSettingsStatusMessage(status: SettingsStatus, error: string | null, activeRole: string | null): string {
  if (status === "loading") {
    return "서버 비용 설정을 불러오는 중입니다.";
  }
  if (status === "saving") {
    return "테넌트 비용 설정을 저장하는 중입니다.";
  }
  if (status === "saved") {
    return "테넌트 비용 설정을 저장했습니다.";
  }
  if (status === "ready") {
    return "서버 비용 설정을 불러왔습니다.";
  }
  if (status === "blocked") {
    return error ?? "SETTINGS_BLOCKED";
  }
  if (activeRole) {
    return `현재 테넌트 역할: ${activeRole}.`;
  }
  return "프로바이더 설정을 불러올 수 있습니다.";
}

function readOptionalString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readStringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readNumberValue(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  return "";
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toISOString();
}
