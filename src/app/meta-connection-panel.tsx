"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { ExternalLink, Link2, RefreshCw, ShieldCheck } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type ConnectStatus = "idle" | "loading" | "ready" | "blocked";

interface ConnectUrlResponse {
  connectUrl?: string;
  requiredScopes?: string[];
  optionalScopes?: string[];
  stateBound?: boolean;
  stateExpiresAt?: string;
  tokenPolicy?: string;
  error?: {
    code?: string;
    message?: string;
  };
}

interface TenantMembership {
  tenantId: string;
  name: string;
  role: string;
}

interface MeResponse {
  memberships?: TenantMembership[];
  activeTenant?: TenantMembership | null;
  error?: {
    code?: string;
  };
}

const TENANT_STORAGE_KEY = "hermes:tenant-id";

export function MetaConnectionPanel() {
  const [tenantId, setTenantId] = useState("");
  const [memberships, setMemberships] = useState<TenantMembership[]>([]);
  const [membershipStatus, setMembershipStatus] = useState<"idle" | "loaded" | "blocked">("idle");
  const [status, setStatus] = useState<ConnectStatus>("idle");
  const [result, setResult] = useState<ConnectUrlResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const storedTenantId = readTenantId();
    setTenantId(storedTenantId);
    void loadTenantMemberships(storedTenantId, setTenantId, setMemberships, setMembershipStatus);
  }, []);

  const requiredScopes = useMemo(() => result?.requiredScopes ?? [], [result]);
  const optionalScopes = useMemo(() => result?.optionalScopes ?? [], [result]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedTenantId = tenantId.trim();
    if (!normalizedTenantId) {
      setStatus("blocked");
      setError("TENANT_ID_REQUIRED");
      setResult(null);
      return;
    }

    persistTenantId(normalizedTenantId);
    setTenantId(normalizedTenantId);
    setStatus("loading");
    setError(null);
    setResult(null);

    const headers: Record<string, string> = {
      "x-tenant-id": normalizedTenantId
    };
    const bearer = await getSupabaseBearer();
    if (bearer) {
      headers.authorization = `Bearer ${bearer}`;
    }

    const response = await fetch("/api/integrations/meta/connect-url", {
      method: "GET",
      headers
    });
    const body = (await response.json()) as ConnectUrlResponse;

    if (!response.ok || !body.connectUrl) {
      setStatus("blocked");
      setError(body.error?.code ?? `HTTP_${response.status}`);
      setResult(body);
      return;
    }

    setStatus("ready");
    setResult(body);
  }

  return (
    <section className="panel meta-connection-panel" id="meta-connection">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">
            <Link2 aria-hidden="true" size={14} />
            메타 연결
          </p>
          <h2>OAuth 연결 넘겨주기</h2>
          <p className="muted">메타 OAuth로 이동하기 전에 테넌트 단위 서명 state를 준비합니다.</p>
        </div>
        <span className="tag good">서버 토큰 저장</span>
      </div>

      <form className="meta-connect-form" onSubmit={handleSubmit}>
        <label className="field meta-tenant-field">
          <span>{memberships.length > 0 ? "테넌트" : "테넌트 ID"}</span>
          {memberships.length > 0 ? (
            <select
              onChange={(event) => {
                persistTenantId(event.target.value);
                setTenantId(event.target.value);
              }}
              value={tenantId}
            >
              {memberships.map((membership) => (
                <option key={membership.tenantId} value={membership.tenantId}>
                  {membership.name} ({membership.role})
                </option>
              ))}
            </select>
          ) : (
            <input
              autoComplete="off"
              inputMode="text"
              onChange={(event) => setTenantId(event.target.value)}
              placeholder="테넌트 UUID"
              value={tenantId}
            />
          )}
        </label>
        <button
          className="approve-button meta-connect-button"
          disabled={status === "loading" || !tenantId.trim()}
          type="submit"
        >
          <RefreshCw aria-hidden="true" size={16} />
          URL 준비
        </button>
      </form>

      <div className={`meta-connection-state ${status}`} aria-live="polite">
        <ShieldCheck aria-hidden="true" size={16} />
        <span>{getStatusMessage(status, error, membershipStatus)}</span>
      </div>

      {result ? (
        <div className="meta-connection-details">
          <div className="meta-detail-row">
            <span>토큰 정책</span>
            <strong>{result.tokenPolicy ?? "고객은 메타 액세스 토큰을 직접 붙여넣지 않습니다."}</strong>
          </div>
          <div className="meta-detail-row">
            <span>서명 state</span>
            <strong>{result.stateBound ? "사용자와 테넌트에 바인딩됨" : "사용 불가"}</strong>
          </div>
          <div className="meta-detail-row">
            <span>state 만료</span>
            <strong>{formatExpiry(result.stateExpiresAt)}</strong>
          </div>
          <div className="scope-groups">
            <ScopeList label="필수 권한" scopes={requiredScopes} />
            <ScopeList label="확장 권한" scopes={optionalScopes} />
          </div>
          {result.connectUrl ? (
            <a className="meta-oauth-link" href={result.connectUrl} rel="noreferrer" target="_blank">
              <ExternalLink aria-hidden="true" size={16} />
              메타 OAuth 열기
            </a>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ScopeList({ label, scopes }: { label: string; scopes: string[] }) {
  return (
    <div className="scope-list">
      <span>{label}</span>
      <ul>
        {scopes.length > 0 ? scopes.map((scope) => <li key={scope}>{scope}</li>) : <li>사용 불가</li>}
      </ul>
    </div>
  );
}

function readTenantId(): string {
  try {
    return (
      window.sessionStorage.getItem(TENANT_STORAGE_KEY) ??
      window.localStorage.getItem(TENANT_STORAGE_KEY) ??
      ""
    );
  } catch {
    return "";
  }
}

function persistTenantId(tenantId: string): void {
  try {
    window.sessionStorage.setItem(TENANT_STORAGE_KEY, tenantId);
    window.localStorage.setItem(TENANT_STORAGE_KEY, tenantId);
  } catch {
    // Storage can be disabled in hardened browsers; the header still carries the tenant for this request.
  }
}

async function getSupabaseBearer(): Promise<string | undefined> {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) {
    return undefined;
  }
  const session = await supabase.auth.getSession();
  return session.data.session?.access_token;
}

async function loadTenantMemberships(
  storedTenantId: string,
  setTenantId: (tenantId: string) => void,
  setMemberships: (memberships: TenantMembership[]) => void,
  setMembershipStatus: (status: "idle" | "loaded" | "blocked") => void
): Promise<void> {
  try {
    const bearer = await getSupabaseBearer();
    if (!bearer) {
      return;
    }

    const response = await fetch("/api/me", {
      headers: {
        authorization: `Bearer ${bearer}`
      }
    });
    const body = (await response.json()) as MeResponse;
    if (!response.ok) {
      setMembershipStatus("blocked");
      return;
    }

    const nextMemberships = body.memberships ?? [];
    setMemberships(nextMemberships);
    setMembershipStatus("loaded");

    const preferredTenant =
      nextMemberships.find((membership) => membership.tenantId === storedTenantId) ??
      body.activeTenant ??
      nextMemberships[0];

    if (preferredTenant && preferredTenant.tenantId !== storedTenantId) {
      setTenantId(preferredTenant.tenantId);
      persistTenantId(preferredTenant.tenantId);
    }
  } catch {
    setMembershipStatus("blocked");
  }
}

function getStatusMessage(
  status: ConnectStatus,
  error: string | null,
  membershipStatus: "idle" | "loaded" | "blocked"
): string {
  if (status === "loading") {
    return "서명된 OAuth state를 준비하는 중입니다.";
  }
  if (status === "ready") {
    return "메타 OAuth URL이 준비됐습니다.";
  }
  if (status === "blocked") {
    return `연결 URL 생성이 차단됐습니다: ${error ?? "UNKNOWN_ERROR"}.`;
  }
  if (membershipStatus === "loaded") {
    return "Supabase Auth에서 테넌트 멤버십을 불러왔습니다.";
  }
  if (membershipStatus === "blocked") {
    return "테넌트 멤버십 조회가 차단됐습니다.";
  }
  return "메타 OAuth URL을 준비할 수 있습니다.";
}

function formatExpiry(value: string | undefined): string {
  if (!value) {
    return "사용 불가";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toISOString();
}
