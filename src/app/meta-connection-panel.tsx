"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { ExternalLink, Link2, RefreshCw, ShieldCheck } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const TENANT_STORAGE_KEY = "hermes:tenant-id";

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
}

export function MetaConnectionPanel() {
  const [tenantId, setTenantId] = useState("");
  const [memberships, setMemberships] = useState<TenantMembership[]>([]);
  const [status, setStatus] = useState<ConnectStatus>("idle");
  const [result, setResult] = useState<ConnectUrlResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const storedTenantId = readTenantId();
    setTenantId(storedTenantId);
    void loadTenantMemberships(storedTenantId);
  }, []);

  const requiredScopes = useMemo(() => result?.requiredScopes ?? [], [result]);
  const optionalScopes = useMemo(() => result?.optionalScopes ?? [], [result]);

  async function loadTenantMemberships(storedTenantId: string) {
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
      return;
    }
    const nextMemberships = body.memberships ?? [];
    setMemberships(nextMemberships);
    const preferredTenant = nextMemberships.find((membership) => membership.tenantId === storedTenantId) ?? body.activeTenant ?? nextMemberships[0];
    if (preferredTenant) {
      setTenantId(preferredTenant.tenantId);
      persistTenantId(preferredTenant.tenantId);
    }
  }

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
            Meta 연결
          </p>
          <h2>Meta OAuth 연결 준비</h2>
          <p className="muted">고객 토큰은 서버에만 암호화 저장됩니다. 브라우저에는 연결 URL과 권한 상태만 표시합니다.</p>
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
            <input autoComplete="off" onChange={(event) => setTenantId(event.target.value)} placeholder="테넌트 UUID" value={tenantId} />
          )}
        </label>
        <button className="approve-button meta-connect-button" disabled={status === "loading" || !tenantId.trim()} type="submit">
          <RefreshCw aria-hidden="true" size={16} />
          연결 URL 준비
        </button>
      </form>

      <div className={`meta-connection-state ${status}`} aria-live="polite">
        <ShieldCheck aria-hidden="true" size={16} />
        <span>{getStatusMessage(status, error)}</span>
      </div>

      {result ? (
        <div className="meta-connection-details">
          <div className="meta-detail-row">
            <span>토큰 정책</span>
            <strong>{result.tokenPolicy ?? "고객 Meta 토큰은 서버에서만 처리합니다."}</strong>
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
      <ul>{scopes.length > 0 ? scopes.map((scope) => <li key={scope}>{scope}</li>) : <li>사용 불가</li>}</ul>
    </div>
  );
}

async function getSupabaseBearer(): Promise<string | undefined> {
  const supabase = createSupabaseBrowserClient();
  const session = await supabase?.auth.getSession();
  return session?.data.session?.access_token;
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
    // Storage can be disabled.
  }
}

function getStatusMessage(status: ConnectStatus, error: string | null): string {
  if (status === "loading") return "서명된 OAuth state를 준비하는 중입니다.";
  if (status === "ready") return "Meta OAuth URL이 준비됐습니다.";
  if (status === "blocked") return `연결 URL 생성이 차단됐습니다: ${error ?? "UNKNOWN_ERROR"}.`;
  return "Meta OAuth URL을 준비할 수 있습니다.";
}

function formatExpiry(value: string | undefined): string {
  if (!value) return "사용 불가";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}
