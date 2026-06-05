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
            Meta Connection
          </p>
          <h2>OAuth connection handoff</h2>
          <p className="muted">Tenant-scoped signed state is prepared before the Meta OAuth redirect.</p>
        </div>
        <span className="tag good">Server-token storage</span>
      </div>

      <form className="meta-connect-form" onSubmit={handleSubmit}>
        <label className="field meta-tenant-field">
          <span>{memberships.length > 0 ? "Tenant" : "Tenant ID"}</span>
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
              placeholder="tenant uuid"
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
          Prepare URL
        </button>
      </form>

      <div className={`meta-connection-state ${status}`} aria-live="polite">
        <ShieldCheck aria-hidden="true" size={16} />
        <span>{getStatusMessage(status, error, membershipStatus)}</span>
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
    return "Preparing a signed OAuth state.";
  }
  if (status === "ready") {
    return "Meta OAuth URL is ready.";
  }
  if (status === "blocked") {
    return `Connect URL blocked: ${error ?? "UNKNOWN_ERROR"}.`;
  }
  if (membershipStatus === "loaded") {
    return "Tenant membership loaded from Supabase Auth.";
  }
  if (membershipStatus === "blocked") {
    return "Tenant membership lookup was blocked.";
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
