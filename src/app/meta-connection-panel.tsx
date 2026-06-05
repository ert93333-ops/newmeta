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

const TENANT_STORAGE_KEY = "hermes:tenant-id";

export function MetaConnectionPanel() {
  const [tenantId, setTenantId] = useState("");
  const [status, setStatus] = useState<ConnectStatus>("idle");
  const [result, setResult] = useState<ConnectUrlResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTenantId(readTenantId());
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
            Meta Connection
          </p>
          <h2>OAuth connection handoff</h2>
          <p className="muted">Tenant-scoped signed state is prepared before the Meta OAuth redirect.</p>
        </div>
        <span className="tag good">Server-token storage</span>
      </div>

      <form className="meta-connect-form" onSubmit={handleSubmit}>
        <label className="field meta-tenant-field">
          <span>Tenant ID</span>
          <input
            autoComplete="off"
            inputMode="text"
            onChange={(event) => setTenantId(event.target.value)}
            placeholder="tenant uuid"
            value={tenantId}
          />
        </label>
        <button
          className="approve-button meta-connect-button"
          disabled={status === "loading" || !tenantId.trim()}
          type="submit"
        >
          <RefreshCw aria-hidden="true" size={16} />
          Prepare URL
        </button>
      </form>

      <div className={`meta-connection-state ${status}`} aria-live="polite">
        <ShieldCheck aria-hidden="true" size={16} />
        <span>{getStatusMessage(status, error)}</span>
      </div>

      {result ? (
        <div className="meta-connection-details">
          <div className="meta-detail-row">
            <span>Token policy</span>
            <strong>{result.tokenPolicy ?? "Customers never paste Meta access tokens."}</strong>
          </div>
          <div className="meta-detail-row">
            <span>Signed state</span>
            <strong>{result.stateBound ? "Bound to user and tenant" : "Unavailable"}</strong>
          </div>
          <div className="meta-detail-row">
            <span>State expiry</span>
            <strong>{formatExpiry(result.stateExpiresAt)}</strong>
          </div>
          <div className="scope-groups">
            <ScopeList label="Required scopes" scopes={requiredScopes} />
            <ScopeList label="Optional scopes" scopes={optionalScopes} />
          </div>
          {result.connectUrl ? (
            <a className="meta-oauth-link" href={result.connectUrl} rel="noreferrer" target="_blank">
              <ExternalLink aria-hidden="true" size={16} />
              Open Meta OAuth
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
        {scopes.length > 0 ? scopes.map((scope) => <li key={scope}>{scope}</li>) : <li>Unavailable</li>}
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

function getStatusMessage(status: ConnectStatus, error: string | null): string {
  if (status === "loading") {
    return "Preparing a signed OAuth state.";
  }
  if (status === "ready") {
    return "Meta OAuth URL is ready.";
  }
  if (status === "blocked") {
    return `Connect URL blocked: ${error ?? "UNKNOWN_ERROR"}.`;
  }
  return "Ready to prepare a Meta OAuth URL.";
}

function formatExpiry(value: string | undefined): string {
  if (!value) {
    return "Unavailable";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toISOString();
}
