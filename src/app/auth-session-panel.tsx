"use client";

import { type FormEvent, useEffect, useState } from "react";
import { LogIn, LogOut, RefreshCw, ShieldCheck } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const TENANT_STORAGE_KEY = "hermes:tenant-id";

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
    message?: string;
  };
}

type AuthStatus = "idle" | "loading" | "signed_in" | "blocked";

export function AuthSessionPanel() {
  const [email, setEmail] = useState("ert93333@gmail.com");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<AuthStatus>("idle");
  const [message, setMessage] = useState("운영 계정으로 로그인하면 테넌트와 권한이 자동으로 연결됩니다.");
  const [memberships, setMemberships] = useState<TenantMembership[]>([]);

  useEffect(() => {
    void refreshSession();
  }, []);

  async function refreshSession() {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setStatus("blocked");
      setMessage("Supabase 브라우저 설정이 없습니다.");
      return;
    }

    const session = await supabase.auth.getSession();
    if (!session.data.session?.access_token) {
      setStatus("idle");
      return;
    }

    await loadMemberships(session.data.session.access_token);
  }

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("loading");
    setMessage("로그인 중입니다.");

    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setStatus("blocked");
      setMessage("Supabase 브라우저 설정이 없습니다.");
      return;
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password
    });

    if (error || !data.session?.access_token) {
      setStatus("blocked");
      setMessage(error?.message ?? "로그인 세션을 만들지 못했습니다.");
      return;
    }

    await loadMemberships(data.session.access_token);
  }

  async function handleSignOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase?.auth.signOut();
    try {
      window.sessionStorage.removeItem(TENANT_STORAGE_KEY);
      window.localStorage.removeItem(TENANT_STORAGE_KEY);
    } catch {
      // Hardened browsers can block storage access.
    }
    setMemberships([]);
    setPassword("");
    setStatus("idle");
    setMessage("로그아웃했습니다.");
  }

  async function loadMemberships(accessToken: string) {
    const response = await fetch("/api/me", {
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    const body = (await response.json()) as MeResponse;

    if (!response.ok) {
      setStatus("blocked");
      setMessage(body.error?.code ?? "테넌트 권한을 불러오지 못했습니다.");
      return;
    }

    const nextMemberships = body.memberships ?? [];
    const activeTenant = body.activeTenant ?? nextMemberships[0];
    if (activeTenant) {
      persistTenantId(activeTenant.tenantId);
    }

    setMemberships(nextMemberships);
    setStatus("signed_in");
    setMessage(activeTenant ? `${activeTenant.name} 테넌트에 ${activeTenant.role} 권한으로 연결됐습니다.` : "로그인됐지만 테넌트가 없습니다.");
  }

  return (
    <section className="panel auth-session-panel" id="login">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">
            <ShieldCheck aria-hidden="true" size={14} />
            운영 로그인
          </p>
          <h2>Hermes 계정 연결</h2>
          <p className="muted">Supabase Free 운영 모드는 공개 가입 없이 등록된 사용자만 접근합니다.</p>
        </div>
        <span className={`tag ${status === "signed_in" ? "good" : status === "blocked" ? "bad" : "warn"}`}>
          {status === "signed_in" ? "로그인됨" : status === "loading" ? "확인 중" : status === "blocked" ? "차단" : "대기"}
        </span>
      </div>

      <form className="auth-form" onSubmit={handleSignIn}>
        <label className="field">
          <span>이메일</span>
          <input autoComplete="email" onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
        </label>
        <label className="field">
          <span>비밀번호</span>
          <input
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="로컬 보안 파일의 PASSWORD"
            type="password"
            value={password}
          />
        </label>
        <div className="auth-actions">
          <button className="approve-button" disabled={status === "loading" || !email.trim() || !password} type="submit">
            <LogIn aria-hidden="true" size={16} />
            로그인
          </button>
          <button className="reject-button" onClick={handleSignOut} type="button">
            <LogOut aria-hidden="true" size={16} />
            로그아웃
          </button>
          <button className="reject-button" onClick={refreshSession} type="button">
            <RefreshCw aria-hidden="true" size={16} />
            새로고침
          </button>
        </div>
      </form>

      <div className={`auth-state ${status}`} aria-live="polite">
        {message}
      </div>

      {memberships.length > 0 ? (
        <div className="auth-memberships">
          {memberships.map((membership) => (
            <div className="check-row" key={membership.tenantId}>
              <span>{membership.name}</span>
              <strong>{membership.role}</strong>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function persistTenantId(tenantId: string): void {
  try {
    window.sessionStorage.setItem(TENANT_STORAGE_KEY, tenantId);
    window.localStorage.setItem(TENANT_STORAGE_KEY, tenantId);
  } catch {
    // The current request is still authenticated even if storage is unavailable.
  }
}
