"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, ShieldAlert, XCircle } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type ApprovalSummary = {
  id: string;
  action: string;
  objectType: string;
  objectId?: string;
  riskLevel: string;
  status: string;
  reason?: string;
  requestedBy?: string;
  createdBy?: string;
  createdAt?: string;
  expiresAt?: string;
};

type ApprovalGuardSummary = {
  riskLevel: string;
  requiresSecondApproval: boolean;
  typedConfirmationRequired: boolean;
  requiredText?: string;
  expiresAt?: string;
};

type ApprovalListItem = {
  approval: ApprovalSummary;
  guard: ApprovalGuardSummary;
};

type ApprovalListResponse = {
  approvals?: ApprovalListItem[];
  error?: {
    code?: string;
    message?: string;
  };
};

type LoadStatus = "loading" | "loaded" | "empty" | "blocked";

const TENANT_STORAGE_KEY = "hermes:tenant-id";

export function ApprovalCenterPanel() {
  const [approvals, setApprovals] = useState<ApprovalListItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [typedConfirmation, setTypedConfirmation] = useState("");
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadApprovals() {
      const headers: Record<string, string> = {};
      const tenantId = readTenantId();
      if (tenantId) {
        headers["x-tenant-id"] = tenantId;
      }
      const bearer = await getSupabaseBearer();
      if (bearer) {
        headers.authorization = `Bearer ${bearer}`;
      }

      try {
        const response = await fetch("/api/approvals", { headers });
        const body = (await response.json()) as ApprovalListResponse;
        if (!isMounted) {
          return;
        }
        if (!response.ok) {
          setApprovals([]);
          setSelectedId("");
          setLoadStatus("blocked");
          setLoadError(body.error?.code ?? `HTTP_${response.status}`);
          return;
        }

        const nextApprovals = body.approvals ?? [];
        setApprovals(nextApprovals);
        setSelectedId((currentId) =>
          nextApprovals.some((item) => item.approval.id === currentId) ? currentId : nextApprovals[0]?.approval.id ?? ""
        );
        setLoadStatus(nextApprovals.length > 0 ? "loaded" : "empty");
        setLoadError(null);
      } catch {
        if (!isMounted) {
          return;
        }
        setApprovals([]);
        setSelectedId("");
        setLoadStatus("blocked");
        setLoadError("APPROVAL_LIST_UNAVAILABLE");
      }
    }

    void loadApprovals();
    return () => {
      isMounted = false;
    };
  }, []);

  const selected = useMemo(
    () => approvals.find((item) => item.approval.id === selectedId) ?? approvals[0],
    [approvals, selectedId]
  );
  const requiredText = selected?.guard.requiredText;
  const isMatched = requiredText ? typedConfirmation.trim() === requiredText : true;
  const guardCode = selected ? (requiredText && !isMatched ? "TYPED_CONFIRMATION_REQUIRED" : "READY") : loadError ?? loadStatus;

  return (
    <section className="panel approval-panel" id="approval-center">
      <div className="panel-heading">
        <div>
          <h2>Approval Center</h2>
          <p className="muted">{getLoadMessage(loadStatus, loadError)}</p>
        </div>
        <span className={`tag ${loadStatus === "blocked" ? "bad" : "warn"}`}>server guarded</span>
      </div>

      <div className="approval-layout">
        <div className="approval-list" aria-label="Approval requests">
          {loadStatus === "loading" ? (
            <div className="approval-empty" role="status">
              <Loader2 aria-hidden="true" size={18} />
              <span>Loading approvals</span>
            </div>
          ) : null}
          {loadStatus === "empty" ? (
            <div className="approval-empty" role="status">
              <CheckCircle2 aria-hidden="true" size={18} />
              <span>No pending approvals</span>
            </div>
          ) : null}
          {loadStatus === "blocked" ? (
            <div className="approval-empty blocked" role="status">
              <XCircle aria-hidden="true" size={18} />
              <span>{loadError ?? "APPROVAL_LIST_BLOCKED"}</span>
            </div>
          ) : null}
          {approvals.map(({ approval, guard }) => (
            <button
              className={`approval-row ${approval.id === selected?.approval.id ? "selected" : ""}`}
              key={approval.id}
              onClick={() => {
                setSelectedId(approval.id);
                setTypedConfirmation("");
              }}
              type="button"
            >
              <span>
                <strong>{formatAction(approval.action)}</strong>
                <small>
                  {formatObject(approval.objectType, approval.objectId)} - {approval.status}
                </small>
              </span>
              <span className={`risk-chip ${guard.riskLevel}`}>{guard.riskLevel}</span>
            </button>
          ))}
        </div>

        {selected ? (
          <form className="approval-form" onSubmit={(event) => event.preventDefault()}>
            <div className="approval-form-head">
              <ShieldAlert aria-hidden="true" size={20} />
              <div>
                <strong>{selected.approval.action}</strong>
                <small>
                  Requested by {selected.approval.requestedBy ?? selected.approval.createdBy ?? "unknown"}
                  {selected.guard.requiresSecondApproval ? " - second approval required" : ""}
                </small>
              </div>
            </div>

            <label className="field">
              <span>Typed confirmation</span>
              <code>{requiredText ?? "Not required"}</code>
              <input
                aria-label="Typed confirmation"
                disabled={!requiredText}
                onChange={(event) => setTypedConfirmation(event.target.value)}
                placeholder={requiredText ?? "No typed confirmation required"}
                value={typedConfirmation}
              />
            </label>

            <div className="approval-meta">
              <span>Status</span>
              <strong>{selected.approval.status}</strong>
              <span>Expires</span>
              <strong>{formatDate(selected.guard.expiresAt ?? selected.approval.expiresAt)}</strong>
              <span>Reason</span>
              <strong>{selected.approval.reason ?? "Unavailable"}</strong>
            </div>

            <div className={`guard-state ${isMatched ? "ready" : "blocked"}`} role="status">
              {isMatched ? <CheckCircle2 aria-hidden="true" size={18} /> : <XCircle aria-hidden="true" size={18} />}
              <span>{guardCode}</span>
            </div>

            <button className="approve-button" disabled={!isMatched} type="submit">
              <CheckCircle2 aria-hidden="true" size={18} />
              Submit approval
            </button>
          </form>
        ) : (
          <div className="approval-form approval-form-empty">
            <ShieldAlert aria-hidden="true" size={20} />
            <strong>{guardCode}</strong>
          </div>
        )}
      </div>
    </section>
  );
}

function readTenantId(): string {
  try {
    return window.sessionStorage.getItem(TENANT_STORAGE_KEY) ?? window.localStorage.getItem(TENANT_STORAGE_KEY) ?? "";
  } catch {
    return "";
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

function formatAction(action: string): string {
  return action.replaceAll("_", " ");
}

function formatObject(objectType: string, objectId: string | undefined): string {
  return objectId ? `${objectType}:${objectId}` : objectType;
}

function formatDate(value: string | undefined): string {
  if (!value) {
    return "Unavailable";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toISOString();
}

function getLoadMessage(status: LoadStatus, error: string | null): string {
  if (status === "loading") {
    return "Loading tenant approval queue.";
  }
  if (status === "loaded") {
    return "Tenant-scoped approvals loaded from the server.";
  }
  if (status === "empty") {
    return "No pending approval requests.";
  }
  return `Approval list blocked: ${error ?? "UNKNOWN_ERROR"}.`;
}
