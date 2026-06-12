"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { KeyRound, Lock, RefreshCw, Save, Settings2, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const TENANT_STORAGE_KEY = "hermes:tenant-id";
const ROLE_RANK: Record<string, number> = {
  owner: 5,
  admin: 4,
  marketer: 3,
  analyst: 2,
  viewer: 1
};

const PROVIDERS = [
  { value: "openai", label: "OpenAI", hint: "이미지 생성, 카피/분석 보조", endpointUrl: "https://api.openai.com/v1" },
  { value: "anthropic", label: "Claude / Anthropic", hint: "긴 문맥 분석, 정책 검토", endpointUrl: "https://api.anthropic.com/v1" },
  { value: "higgsfield", label: "Higgsfield", hint: "영상/소재 생성 provider", endpointUrl: "https://api.higgsfield.ai/v1" },
  { value: "generic_http", label: "Generic HTTPS", hint: "커스텀 생성 API", endpointUrl: "" }
] as const;

interface TenantMembership {
  tenantId: string;
  name: string;
  role: string;
}

interface MeResponse {
  memberships?: TenantMembership[];
  activeTenant?: TenantMembership | null;
}

interface SettingsResponse {
  configured?: boolean;
  setting?: {
    settingsJson?: Record<string, unknown> | null;
    updatedAt?: string;
  } | null;
  error?: {
    code?: string;
  };
}

interface CredentialStatus {
  provider?: string;
  configured?: boolean;
  endpointConfigured?: boolean;
  endpointUrl?: string;
  keyPreview?: string;
  updatedAt?: string;
  error?: {
    code?: string;
  };
}

type OpsPolicyForm = {
  adLaunchMode: "disabled" | "approval_required";
  statusChangeMode: "approval_required" | "admin_approval";
  spendEditMode: "disabled" | "recommendation_only";
  creativeCreateMode: "approval_required" | "marketer_allowed";
  destructiveMode: "double_approval";
  maxPausedDraftsPerDay: string;
  maxPaidGenerationsPerDay: string;
  requireHumanReviewForNewCreative: boolean;
  requirePolicyCheckBeforeDraft: boolean;
};

type CostForm = {
  providerName: string;
  dailyCostCapKrw: string;
  hardDailyCapKrw: string;
  monthlyCostCapKrw: string;
  imageGenerationCreditCost: string;
  videoGenerationCreditCost: string;
  analysisCreditCost: string;
};

const DEFAULT_POLICY: OpsPolicyForm = {
  adLaunchMode: "approval_required",
  statusChangeMode: "approval_required",
  spendEditMode: "recommendation_only",
  creativeCreateMode: "approval_required",
  destructiveMode: "double_approval",
  maxPausedDraftsPerDay: "10",
  maxPaidGenerationsPerDay: "20",
  requireHumanReviewForNewCreative: true,
  requirePolicyCheckBeforeDraft: true
};

const DEFAULT_COST: CostForm = {
  providerName: "openai",
  dailyCostCapKrw: "5000",
  hardDailyCapKrw: "7500",
  monthlyCostCapKrw: "100000",
  imageGenerationCreditCost: "5",
  videoGenerationCreditCost: "30",
  analysisCreditCost: "1"
};

export function SettingsPanel() {
  const [tenantId, setTenantId] = useState("");
  const [memberships, setMemberships] = useState<TenantMembership[]>([]);
  const [role, setRole] = useState<string | null>(null);
  const [policy, setPolicy] = useState<OpsPolicyForm>(DEFAULT_POLICY);
  const [cost, setCost] = useState<CostForm>(DEFAULT_COST);
  const [provider, setProvider] = useState<string>(PROVIDERS[0].value);
  const [credentialValue, setCredentialValue] = useState("");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [credentialStatus, setCredentialStatus] = useState<CredentialStatus | null>(null);
  const [status, setStatus] = useState("설정을 불러오는 중입니다.");
  const canWritePolicy = role ? (ROLE_RANK[role] ?? 0) >= ROLE_RANK.marketer : true;
  const canWriteCredential = role ? (ROLE_RANK[role] ?? 0) >= ROLE_RANK.admin : true;

  useEffect(() => {
    const storedTenantId = readTenantId();
    setTenantId(storedTenantId);
    void initialize(storedTenantId);
  }, []);

  const selectedProvider = useMemo(() => PROVIDERS.find((item) => item.value === provider) ?? PROVIDERS[0], [provider]);

  useEffect(() => {
    if (!endpointUrl && selectedProvider.endpointUrl) {
      setEndpointUrl(selectedProvider.endpointUrl);
    }
  }, [endpointUrl, selectedProvider]);

  async function initialize(storedTenantId: string) {
    const context = await loadMembershipContext(storedTenantId);
    setMemberships(context.memberships);
    setRole(context.role ?? null);
    if (context.tenantId) {
      setTenantId(context.tenantId);
      persistTenantId(context.tenantId);
    }
    await Promise.all([
      loadPolicy(context.tenantId ?? storedTenantId),
      loadCost(context.tenantId ?? storedTenantId),
      loadCredentialStatus(provider, context.tenantId ?? storedTenantId)
    ]);
  }

  async function loadPolicy(explicitTenantId?: string) {
    const response = await fetch("/api/settings/ai-ops-permissions", {
      headers: await createTenantHeaders(explicitTenantId)
    });
    const body = (await response.json()) as SettingsResponse;
    if (response.ok && body.setting?.settingsJson) {
      setPolicy((current) => ({ ...current, ...normalizePolicy(body.setting?.settingsJson) }));
    }
  }

  async function loadCost(explicitTenantId?: string) {
    const response = await fetch(`/api/settings/${encodeURIComponent(DEFAULT_COST.providerName)}`, {
      headers: await createTenantHeaders(explicitTenantId)
    });
    const body = (await response.json()) as SettingsResponse;
    if (response.ok && body.setting?.settingsJson) {
      setCost((current) => ({ ...current, ...normalizeCost(body.setting?.settingsJson) }));
    }
  }

  async function loadCredentialStatus(nextProvider = provider, explicitTenantId?: string) {
    const response = await fetch(`/api/settings/provider-credentials?provider=${encodeURIComponent(nextProvider)}`, {
      headers: await createTenantHeaders(explicitTenantId)
    });
    const body = (await response.json()) as CredentialStatus;
    setCredentialStatus(response.ok ? body : { provider: nextProvider, configured: false, error: body.error });
    if (body.endpointUrl) {
      setEndpointUrl(body.endpointUrl);
    } else if (!body.endpointConfigured) {
      const nextDefaultUrl = PROVIDERS.find((item) => item.value === nextProvider)?.endpointUrl ?? "";
      setEndpointUrl(nextDefaultUrl);
    }
  }

  async function savePolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWritePolicy) {
      setStatus("권한이 부족합니다. marketer 이상만 운영 정책을 저장할 수 있습니다.");
      return;
    }
    const response = await fetch("/api/settings/ai-ops-permissions", {
      method: "PATCH",
      headers: {
        ...(await createTenantHeaders()),
        "content-type": "application/json"
      },
      body: JSON.stringify(toPolicyPayload(policy))
    });
    setStatus(response.ok ? "AI 광고 운영 권한 정책을 저장했습니다." : "운영 권한 정책 저장에 실패했습니다.");
  }

  async function saveCost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWritePolicy) {
      setStatus("권한이 부족합니다. marketer 이상만 비용 정책을 저장할 수 있습니다.");
      return;
    }
    const response = await fetch(`/api/settings/${encodeURIComponent(cost.providerName)}`, {
      method: "PATCH",
      headers: {
        ...(await createTenantHeaders()),
        "content-type": "application/json"
      },
      body: JSON.stringify(toCostPayload(cost))
    });
    setStatus(response.ok ? "생성 provider 비용 정책을 저장했습니다." : "비용 정책 저장에 실패했습니다.");
  }

  async function saveCredential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWriteCredential) {
      setStatus("권한이 부족합니다. admin 이상만 provider API 키를 저장할 수 있습니다.");
      return;
    }
    const response = await fetch("/api/settings/provider-credentials", {
      method: "POST",
      headers: {
        ...(await createTenantHeaders()),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        provider,
        credentialValue,
        endpointUrl,
        label: selectedProvider.label
      })
    });
    const body = (await response.json()) as CredentialStatus;
    if (response.ok) {
      setCredentialStatus(body);
      setCredentialValue("");
      setStatus(`${selectedProvider.label} API 키를 서버 암호화 저장소에 저장했습니다.`);
      return;
    }
    setStatus(body.error?.code ?? "API 키 저장에 실패했습니다.");
  }

  return (
    <section className="settings-workspace" id="settings">
      <div className="settings-hero">
        <div>
          <h2>설정</h2>
          <p>온보딩 이후에는 여기에서 Meta 연결, AI 광고 운영 권한, 생성 provider, 비용 제한을 관리합니다.</p>
        </div>
        <div className="settings-context">
          <span>현재 테넌트</span>
          <strong>{memberships.find((item) => item.tenantId === tenantId)?.name ?? (tenantId || "선택 필요")}</strong>
          <small>{role ?? "권한 확인 필요"}</small>
        </div>
      </div>

      <div className="settings-sections">
        <form className="settings-card" onSubmit={savePolicy}>
          <div className="section-title-row compact">
            <h3>
              <ShieldCheck aria-hidden="true" size={18} />
              AI 광고 운영 권한
            </h3>
            <span className="tag good">예산 실행 없음</span>
          </div>
          <div className="settings-grid">
            <FieldSelect label="광고 개시" value={policy.adLaunchMode} onChange={(value) => setPolicy((current) => ({ ...current, adLaunchMode: value as OpsPolicyForm["adLaunchMode"] }))}>
              <option value="approval_required">승인 후 가능</option>
              <option value="disabled">비활성화</option>
            </FieldSelect>
            <FieldSelect label="상태 변경" value={policy.statusChangeMode} onChange={(value) => setPolicy((current) => ({ ...current, statusChangeMode: value as OpsPolicyForm["statusChangeMode"] }))}>
              <option value="approval_required">승인 후 가능</option>
              <option value="admin_approval">관리자 승인 필요</option>
            </FieldSelect>
            <FieldSelect label="예산수정" value={policy.spendEditMode} onChange={(value) => setPolicy((current) => ({ ...current, spendEditMode: value as OpsPolicyForm["spendEditMode"] }))}>
              <option value="recommendation_only">추천만 허용</option>
              <option value="disabled">완전 비활성화</option>
            </FieldSelect>
            <FieldSelect label="소재 생성" value={policy.creativeCreateMode} onChange={(value) => setPolicy((current) => ({ ...current, creativeCreateMode: value as OpsPolicyForm["creativeCreateMode"] }))}>
              <option value="approval_required">승인 후 생성</option>
              <option value="marketer_allowed">마케터 이상 허용</option>
            </FieldSelect>
            <label className="field">
              <span>하루 PAUSED 초안 한도</span>
              <input inputMode="numeric" value={policy.maxPausedDraftsPerDay} onChange={(event) => setPolicy((current) => ({ ...current, maxPausedDraftsPerDay: event.target.value }))} />
            </label>
            <label className="field">
              <span>하루 유료 생성 한도</span>
              <input inputMode="numeric" value={policy.maxPaidGenerationsPerDay} onChange={(event) => setPolicy((current) => ({ ...current, maxPaidGenerationsPerDay: event.target.value }))} />
            </label>
          </div>
          <div className="toggle-list">
            <label>
              <input checked={policy.requireHumanReviewForNewCreative} onChange={(event) => setPolicy((current) => ({ ...current, requireHumanReviewForNewCreative: event.target.checked }))} type="checkbox" />
              신규 소재는 사람 검토 필수
            </label>
            <label>
              <input checked={policy.requirePolicyCheckBeforeDraft} onChange={(event) => setPolicy((current) => ({ ...current, requirePolicyCheckBeforeDraft: event.target.checked }))} type="checkbox" />
              초안 생성 전 정책/placement 검사 필수
            </label>
          </div>
          <button className="approve-button" disabled={!canWritePolicy} type="submit">
            <Save aria-hidden="true" size={16} />
            운영 권한 저장
          </button>
        </form>

        <form className="settings-card" onSubmit={saveCredential}>
          <div className="section-title-row compact">
            <h3>
              <KeyRound aria-hidden="true" size={18} />
              Provider API 키
            </h3>
            <span className={`tag ${credentialStatus?.configured ? "good" : "warn"}`}>
              {credentialStatus?.configured ? "저장됨" : "미설정"}
            </span>
          </div>
          <label className="field">
            <span>Provider 선택</span>
            <select
              value={provider}
              onChange={(event) => {
                setProvider(event.target.value);
                setEndpointUrl(PROVIDERS.find((item) => item.value === event.target.value)?.endpointUrl ?? "");
                void loadCredentialStatus(event.target.value);
              }}
            >
              {PROVIDERS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <p className="muted">{selectedProvider.hint}</p>
          <label className="field">
            <span>API 키</span>
            <input autoComplete="off" onChange={(event) => setCredentialValue(event.target.value)} placeholder="키는 저장 후 다시 표시되지 않습니다." type="password" value={credentialValue} />
          </label>
          <label className="field">
            <span>Provider URL</span>
            <input onChange={(event) => setEndpointUrl(event.target.value)} placeholder={selectedProvider.endpointUrl || "https://api.provider.com/v1"} value={endpointUrl} />
          </label>
          <div className="credential-state">
            <Lock aria-hidden="true" size={16} />
            <span>{credentialStatus?.configured ? `저장된 키: ${credentialStatus.keyPreview ?? "마스킹됨"}` : "아직 저장된 키가 없습니다."}</span>
          </div>
          <button className="approve-button" disabled={!credentialValue || !canWriteCredential} type="submit">
            <Save aria-hidden="true" size={16} />
            API 키 암호화 저장
          </button>
        </form>

        <form className="settings-card" onSubmit={saveCost}>
          <div className="section-title-row compact">
            <h3>
              <SlidersHorizontal aria-hidden="true" size={18} />
              생성 비용 제한
            </h3>
            <span className="tag good">서버 정책</span>
          </div>
          <div className="settings-grid">
            <label className="field">
              <span>비용 provider</span>
              <select value={cost.providerName} onChange={(event) => setCost((current) => ({ ...current, providerName: event.target.value }))}>
                {PROVIDERS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <NumberField label="일일 비용 한도" value={cost.dailyCostCapKrw} onChange={(value) => setCost((current) => ({ ...current, dailyCostCapKrw: value }))} />
            <NumberField label="일일 하드 한도" value={cost.hardDailyCapKrw} onChange={(value) => setCost((current) => ({ ...current, hardDailyCapKrw: value }))} />
            <NumberField label="월간 비용 한도" value={cost.monthlyCostCapKrw} onChange={(value) => setCost((current) => ({ ...current, monthlyCostCapKrw: value }))} />
            <NumberField label="이미지 생성 단가" value={cost.imageGenerationCreditCost} onChange={(value) => setCost((current) => ({ ...current, imageGenerationCreditCost: value }))} />
            <NumberField label="영상 생성 단가" value={cost.videoGenerationCreditCost} onChange={(value) => setCost((current) => ({ ...current, videoGenerationCreditCost: value }))} />
          </div>
          <button className="approve-button" disabled={!canWritePolicy} type="submit">
            <Save aria-hidden="true" size={16} />
            비용 정책 저장
          </button>
        </form>

        <div className="settings-card settings-status-card">
          <div className="section-title-row compact">
            <h3>
              <Settings2 aria-hidden="true" size={18} />
              설정 상태
            </h3>
            <button className="reject-button slim" onClick={() => void initialize(tenantId)} type="button">
              <RefreshCw aria-hidden="true" size={14} />
              다시 불러오기
            </button>
          </div>
          <div className="safety-list">
            <div className="safety-row">
              <span>운영 정책 저장 권한</span>
              <strong>{canWritePolicy ? "가능" : "차단"}</strong>
            </div>
            <div className="safety-row">
              <span>API 키 저장 권한</span>
              <strong>{canWriteCredential ? "가능" : "admin 필요"}</strong>
            </div>
            <div className="safety-row">
              <span>예산 변경 실행 경로</span>
              <strong className="good-text">없음</strong>
            </div>
          </div>
          <p className="settings-message">{status}</p>
        </div>
      </div>
    </section>
  );
}

function FieldSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

async function createTenantHeaders(explicitTenantId?: string): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  const tenantId = explicitTenantId ?? readTenantId();
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

async function loadMembershipContext(storedTenantId: string): Promise<{
  tenantId?: string;
  role?: string;
  memberships: TenantMembership[];
}> {
  const supabase = createSupabaseBrowserClient();
  const session = await supabase?.auth.getSession();
  const bearer = session?.data.session?.access_token;
  if (!bearer) {
    return { tenantId: storedTenantId || undefined, memberships: [] };
  }
  const response = await fetch("/api/me", {
    headers: {
      authorization: `Bearer ${bearer}`
    }
  });
  const body = (await response.json()) as MeResponse;
  if (!response.ok) {
    return { tenantId: storedTenantId || undefined, memberships: [] };
  }
  const memberships = body.memberships ?? [];
  const selected = memberships.find((item) => item.tenantId === storedTenantId) ?? body.activeTenant ?? memberships[0];
  return {
    tenantId: selected?.tenantId,
    role: selected?.role,
    memberships
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
    // Storage can be unavailable; the active request still uses headers.
  }
}

function normalizePolicy(value: Record<string, unknown> | null | undefined): Partial<OpsPolicyForm> {
  if (!value) return {};
  return {
    adLaunchMode: readString(value.adLaunchMode, DEFAULT_POLICY.adLaunchMode) as OpsPolicyForm["adLaunchMode"],
    statusChangeMode: readString(value.statusChangeMode, DEFAULT_POLICY.statusChangeMode) as OpsPolicyForm["statusChangeMode"],
    spendEditMode: readString(value.spendEditMode, DEFAULT_POLICY.spendEditMode) as OpsPolicyForm["spendEditMode"],
    creativeCreateMode: readString(value.creativeCreateMode, DEFAULT_POLICY.creativeCreateMode) as OpsPolicyForm["creativeCreateMode"],
    destructiveMode: "double_approval",
    maxPausedDraftsPerDay: readNumberString(value.maxPausedDraftsPerDay, DEFAULT_POLICY.maxPausedDraftsPerDay),
    maxPaidGenerationsPerDay: readNumberString(value.maxPaidGenerationsPerDay, DEFAULT_POLICY.maxPaidGenerationsPerDay),
    requireHumanReviewForNewCreative: value.requireHumanReviewForNewCreative !== false,
    requirePolicyCheckBeforeDraft: value.requirePolicyCheckBeforeDraft !== false
  };
}

function normalizeCost(value: Record<string, unknown> | null | undefined): Partial<CostForm> {
  if (!value) return {};
  return {
    providerName: readString(value.providerName, DEFAULT_COST.providerName),
    dailyCostCapKrw: readNumberString(value.dailyCostCapKrw, DEFAULT_COST.dailyCostCapKrw),
    hardDailyCapKrw: readNumberString(value.hardDailyCapKrw, DEFAULT_COST.hardDailyCapKrw),
    monthlyCostCapKrw: readNumberString(value.monthlyCostCapKrw, DEFAULT_COST.monthlyCostCapKrw),
    imageGenerationCreditCost: readNumberString(value.imageGenerationCreditCost, DEFAULT_COST.imageGenerationCreditCost),
    videoGenerationCreditCost: readNumberString(value.videoGenerationCreditCost, DEFAULT_COST.videoGenerationCreditCost),
    analysisCreditCost: readNumberString(value.analysisCreditCost, DEFAULT_COST.analysisCreditCost)
  };
}

function toPolicyPayload(form: OpsPolicyForm): Record<string, unknown> {
  return {
    adLaunchMode: form.adLaunchMode,
    statusChangeMode: form.statusChangeMode,
    spendEditMode: form.spendEditMode,
    creativeCreateMode: form.creativeCreateMode,
    destructiveMode: form.destructiveMode,
    maxPausedDraftsPerDay: readOptionalNumber(form.maxPausedDraftsPerDay),
    maxPaidGenerationsPerDay: readOptionalNumber(form.maxPaidGenerationsPerDay),
    requireHumanReviewForNewCreative: form.requireHumanReviewForNewCreative,
    requirePolicyCheckBeforeDraft: form.requirePolicyCheckBeforeDraft
  };
}

function toCostPayload(form: CostForm): Record<string, unknown> {
  return {
    providerName: form.providerName,
    dailyCostCapKrw: readOptionalNumber(form.dailyCostCapKrw),
    hardDailyCapKrw: readOptionalNumber(form.hardDailyCapKrw),
    monthlyCostCapKrw: readOptionalNumber(form.monthlyCostCapKrw),
    imageGenerationCreditCost: readOptionalNumber(form.imageGenerationCreditCost),
    videoGenerationCreditCost: readOptionalNumber(form.videoGenerationCreditCost),
    analysisCreditCost: readOptionalNumber(form.analysisCreditCost)
  };
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value ? value : fallback;
}

function readNumberString(value: unknown, fallback: string): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value) return value;
  return fallback;
}

function readOptionalNumber(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
