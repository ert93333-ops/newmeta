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
    message: "Meta OAuth callback received."
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
        message: `Meta OAuth failed: ${error}`
      });
      return;
    }
    if (!code || !oauthState) {
      setState({
        status: "blocked",
        message: "Missing Meta OAuth code or state."
      });
      return;
    }

    void completeMetaOAuth(code, oauthState, setState);
  }, []);

  return (
    <main className="oauth-callback-shell">
      <section className="oauth-callback-panel" aria-live="polite">
        <p className={`oauth-status ${state.status}`}>{state.status}</p>
        <h1>Meta Connection</h1>
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
    message: "Completing Meta connection."
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
      message: `Meta connection blocked: ${body.error?.code ?? response.status}`
    });
    return;
  }

  setState({
    status: "connected",
    message: `Meta connection ${body.connection?.status ?? "connected"}.`
  });
}
