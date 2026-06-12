"use client";

import { useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type CallbackStatus = "pending" | "working" | "connected" | "blocked";

interface CallbackState {
  status: CallbackStatus;
  message: string;
}

export function MetaOAuthCallbackClient() {
  const started = useRef(false);
  const [state, setState] = useState<CallbackState>({
    status: "pending",
    message: "메타 연결 응답을 받았습니다."
  });

  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;

    const params = new URLSearchParams(window.location.hash.replace(/^#/u, ""));
    const error = params.get("error");
    const code = params.get("code");
    const oauthState = params.get("state");
    window.history.replaceState(null, "", window.location.pathname);

    if (error) {
      setState({
        status: "blocked",
        message: `메타 연결이 실패했습니다: ${error}`
      });
      return;
    }
    if (!code || !oauthState) {
      setState({
        status: "blocked",
        message: "메타 연결에 필요한 인증 정보가 없습니다."
      });
      return;
    }

    void completeMetaOAuth(code, oauthState, setState);
  }, []);

  return (
    <main className="oauth-callback-shell">
      <section className="oauth-callback-panel" aria-live="polite">
        <p className={`oauth-status ${state.status}`}>{formatCallbackStatus(state.status)}</p>
        <h1>메타 연결</h1>
        <p>{state.message}</p>
      </section>
    </main>
  );
}

async function completeMetaOAuth(
  code: string,
  state: string,
  setState: (next: CallbackState) => void
): Promise<void> {
  setState({
    status: "working",
    message: "메타 연결을 완료하는 중입니다."
  });

  const headers: Record<string, string> = {
    "content-type": "application/json"
  };
  const supabase = createSupabaseBrowserClient();
  const session = supabase ? await supabase.auth.getSession() : undefined;
  const accessToken = session?.data.session?.access_token;
  const tenantId =
    window.sessionStorage.getItem("hermes:tenant-id") ?? window.localStorage.getItem("hermes:tenant-id");

  if (accessToken) {
    headers.authorization = `Bearer ${accessToken}`;
  }
  if (tenantId) {
    headers["x-tenant-id"] = tenantId;
  }

  const response = await fetch("/api/integrations/meta/callback", {
    method: "POST",
    headers,
    body: JSON.stringify({ code, state })
  });
  const body = (await response.json()) as { error?: { code?: string }; connection?: { status?: string } };

  if (!response.ok) {
    setState({
      status: "blocked",
      message: `메타 연결이 차단됐습니다: ${body.error?.code ?? response.status}`
    });
    return;
  }

  setState({
    status: "connected",
    message: `메타 연결 상태: ${formatConnectionStatus(body.connection?.status ?? "connected")}.`
  });
}

function formatCallbackStatus(status: CallbackStatus): string {
  const labels: Record<CallbackStatus, string> = {
    pending: "대기",
    working: "처리 중",
    connected: "연결됨",
    blocked: "차단됨"
  };
  return labels[status];
}

function formatConnectionStatus(status: string): string {
  const labels: Record<string, string> = {
    connected: "연결됨",
    revoked: "해제됨",
    expired: "만료됨"
  };
  return labels[status] ?? status;
}
