"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  secondApprovedBy?: string;
  afterJson?: Record<string, unknown>;
  executionResultJson?: Record<string, unknown>;
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
    details?: unknown;
  };
};

type LoadStatus = "loading" | "loaded" | "empty" | "blocked";
type DecisionStatus = "idle" | "submitting" | "succeeded" | "blocked";
type ReadinessTone = "ready" | "blocked" | "pending";

type ReadinessStatus = {
  tone: ReadinessTone;
  label: string;
  reason: string;
};

const TENANT_STORAGE_KEY = "hermes:tenant-id";

export function ApprovalCenterPanel() {
  const [approvals, setApprovals] = useState<ApprovalListItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [typedConfirmation, setTypedConfirmation] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [decisionStatus, setDecisionStatus] = useState<DecisionStatus>("idle");
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [executionStatus, setExecutionStatus] = useState<DecisionStatus>("idle");
  const [executionError, setExecutionError] = useState<string | null>(null);

  const loadApprovals = useCallback(async (isMounted: () => boolean = () => true) => {
    setLoadStatus("loading");
    setLoadError(null);
    const headers = await createTenantHeaders();

    try {
      const response = await fetch("/api/approvals", { headers });
      const body = (await response.json()) as ApprovalListResponse;
      if (!isMounted()) {
        return;
      }
      if (!response.ok) {
        setApprovals([]);
        setSelectedId("");
        setLoadStatus("blocked");
        setLoadError(formatApiError(body.error, response.status));
        return;
      }

      const nextApprovals = body.approvals ?? [];
      setApprovals(nextApprovals);
      setSelectedId((currentId) =>
        nextApprovals.some((item) => item.approval.id === currentId) ? currentId : nextApprovals[0]?.approval.id ?? ""
      );
      setLoadStatus(nextApprovals.length > 0 ? "loaded" : "empty");
    } catch {
      if (!isMounted()) {
        return;
      }
      setApprovals([]);
      setSelectedId("");
      setLoadStatus("blocked");
      setLoadError("APPROVAL_LIST_UNAVAILABLE");
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    void loadApprovals(() => mounted);
    return () => {
      mounted = false;
    };
  }, [loadApprovals]);

  useEffect(() => {
    async function handleApprovalCreated(event: Event) {
      const approvalId = readApprovalCreatedId(event);
      await loadApprovals();
      if (approvalId) {
        setSelectedId(approvalId);
      }
    }

    window.addEventListener("hermes:approval-created", handleApprovalCreated);
    return () => {
      window.removeEventListener("hermes:approval-created", handleApprovalCreated);
    };
  }, [loadApprovals]);

  const selected = useMemo(
    () => approvals.find((item) => item.approval.id === selectedId) ?? approvals[0],
    [approvals, selectedId]
  );
  const requiredText = selected?.guard.requiredText;
  const isMatched = requiredText ? typedConfirmation.trim() === requiredText : true;
  const guardCode = selected ? (requiredText && !isMatched ? "TYPED_CONFIRMATION_REQUIRED" : "READY") : loadError ?? loadStatus;
  const canApprove = selected
    ? selected.approval.status === "pending" ||
      (selected.guard.requiresSecondApproval && selected.approval.status === "approved" && !selected.approval.secondApprovedBy)
    : false;
  const canReject = selected ? selected.approval.status === "pending" || selected.approval.status === "approved" : false;
  const canSubmitApproval = canApprove && isMatched && decisionStatus !== "submitting";
  const readiness = selected ? getReadinessStatus(selected) : null;

  async function submitDecision(decision: "approve" | "reject") {
    if (!selected || decisionStatus === "submitting") {
      return;
    }
    setDecisionStatus("submitting");
    setDecisionError(null);

    const headers = {
      ...(await createTenantHeaders()),
      "Content-Type": "application/json"
    };
    const response = await fetch(`/api/approvals/${selected.approval.id}/${decision}`, {
      method: "POST",
      headers,
      body: JSON.stringify(
        decision === "approve"
          ? { typedConfirmation }
          : { reason: rejectionReason.trim() || "승인 센터에서 거절됨" }
      )
    });
    const body = (await response.json()) as ApprovalListResponse;

    if (!response.ok) {
      setDecisionStatus("blocked");
      setDecisionError(formatApiError(body.error, response.status));
      return;
    }

    setDecisionStatus("succeeded");
    setTypedConfirmation("");
    setRejectionReason("");
    await loadApprovals();
  }

  async function queueApprovedGeneration(item: ApprovalListItem) {
    if (executionStatus === "submitting") {
      return;
    }
    setExecutionStatus("submitting");
    setExecutionError(null);

    const afterJson = item.approval.afterJson ?? {};
    const generationContext = readRecord(afterJson.generationContext);
    const operationType = readStringField(afterJson, "operationType") ?? item.approval.objectType;
    const prompt = readStringField(generationContext, "prompt") ?? readStringField(afterJson, "prompt");
    const response = await fetch("/api/render/jobs", {
      method: "POST",
      headers: {
        ...(await createTenantHeaders()),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        operationType,
        approvalRequestId: item.approval.id,
        prompt,
        generationContext,
        input: {
          source: "approval_center",
          approvalObjectId: item.approval.objectId
        }
      })
    });
    const body = (await response.json()) as { error?: ApprovalListResponse["error"]; job?: { id?: string } };
    if (!response.ok) {
      setExecutionStatus("blocked");
      setExecutionError(formatApiError(body.error, response.status));
      return;
    }

    setExecutionStatus("succeeded");
    window.dispatchEvent(new CustomEvent("hermes:generation-job-queued", { detail: { jobId: body.job?.id } }));
    await loadApprovals();
  }

  return (
    <section className="panel approval-panel" id="approval-center">
      <div className="panel-heading">
        <div>
          <h2>승인 센터</h2>
          <p className="muted">{getLoadMessage(loadStatus, loadError)}</p>
        </div>
        <span className={`tag ${loadStatus === "blocked" ? "bad" : "warn"}`}>서버 가드 적용</span>
      </div>

      <div className="approval-layout">
        <div className="approval-list" aria-label="승인 요청">
          {loadStatus === "loading" ? (
            <div className="approval-empty" role="status">
              <Loader2 aria-hidden="true" size={18} />
              <span>승인 요청을 불러오는 중</span>
            </div>
          ) : null}
          {loadStatus === "empty" ? (
            <div className="approval-empty" role="status">
              <CheckCircle2 aria-hidden="true" size={18} />
              <span>대기 중인 승인 요청 없음</span>
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
                setRejectionReason("");
                setDecisionStatus("idle");
                setDecisionError(null);
              }}
              type="button"
            >
              <span>
                <strong>{formatApprovalTitle({ approval, guard })}</strong>
                <small>
                  {formatApprovalSubtitle({ approval, guard })} - {formatApprovalStatus(approval.status)}
                </small>
              </span>
              <span className={`risk-chip ${guard.riskLevel}`}>{guard.riskLevel}</span>
            </button>
          ))}
        </div>

        {selected ? (
          <form
            className="approval-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submitDecision("approve");
            }}
          >
            <div className="approval-form-head">
              <ShieldAlert aria-hidden="true" size={20} />
              <div>
                <strong>{formatApprovalTitle(selected)}</strong>
                <small>
                  {formatApprovalSubtitle(selected)} - 요청자: {selected.approval.requestedBy ?? selected.approval.createdBy ?? "알 수 없음"}
                  {selected.guard.requiresSecondApproval ? " - 2차 승인 필요" : ""}
                </small>
              </div>
            </div>

            <label className="field">
              <span>입력 확인 문구</span>
              <code>{requiredText ?? "필요 없음"}</code>
              <input
                aria-label="입력 확인 문구"
                disabled={!requiredText}
                onChange={(event) => {
                  setTypedConfirmation(event.target.value);
                  setDecisionStatus("idle");
                  setDecisionError(null);
                }}
                placeholder={requiredText ?? "입력 확인 문구가 필요 없습니다"}
                value={typedConfirmation}
              />
            </label>

            <label className="field">
              <span>거절 사유</span>
              <textarea
                onChange={(event) => {
                  setRejectionReason(event.target.value);
                  setDecisionStatus("idle");
                  setDecisionError(null);
                }}
                placeholder="선택 사항: 거절 메모"
                value={rejectionReason}
              />
            </label>

            <div className="approval-meta">
              <span>상태</span>
              <strong>{formatApprovalStatus(selected.approval.status)}</strong>
              <span>만료</span>
              <strong>{formatDate(selected.guard.expiresAt ?? selected.approval.expiresAt)}</strong>
              <span>사유</span>
              <strong>{selected.approval.reason ?? "사용 불가"}</strong>
              <span>2차 승인</span>
              <strong>{selected.approval.secondApprovedBy ? "완료" : selected.guard.requiresSecondApproval ? "필수" : "필요 없음"}</strong>
            </div>

            {readiness ? (
              <div className={`readiness-state ${readiness.tone}`} role="status">
                <span>{readiness.label}</span>
                <strong>{readiness.reason}</strong>
              </div>
            ) : null}

            <div className={`guard-state ${getDecisionTone(decisionStatus, isMatched)}`} role="status">
              {decisionStatus === "submitting" ? (
                <Loader2 aria-hidden="true" size={18} />
              ) : isMatched ? (
                <CheckCircle2 aria-hidden="true" size={18} />
              ) : (
                <XCircle aria-hidden="true" size={18} />
              )}
              <span>{getDecisionMessage(decisionStatus, decisionError, guardCode)}</span>
            </div>

            <div className="approval-actions">
              <button className="approve-button" disabled={!canSubmitApproval} type="submit">
                <CheckCircle2 aria-hidden="true" size={18} />
                승인
              </button>
              {canQueueGeneration(selected) ? (
                <button
                  className="approve-button secondary"
                  disabled={executionStatus === "submitting"}
                  onClick={() => void queueApprovedGeneration(selected)}
                  type="button"
                >
                  <Loader2 aria-hidden="true" size={18} />
                  생성 작업 시작
                </button>
              ) : null}
              <button
                className="reject-button"
                disabled={!canReject || decisionStatus === "submitting"}
                onClick={() => void submitDecision("reject")}
                type="button"
              >
                <XCircle aria-hidden="true" size={18} />
                거절
              </button>
            </div>
            {executionStatus !== "idle" ? (
              <p className="settings-message">{getDecisionMessage(executionStatus, executionError, executionStatus)}</p>
            ) : null}
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

function readApprovalCreatedId(event: Event): string | undefined {
  if (!("detail" in event) || !event.detail || typeof event.detail !== "object") {
    return undefined;
  }
  const detail = event.detail as { approvalId?: unknown };
  return typeof detail.approvalId === "string" ? detail.approvalId : undefined;
}

function canQueueGeneration(item: ApprovalListItem): boolean {
  return item.approval.action === "ai_paid_generation" && item.approval.status === "approved";
}

function formatApprovalTitle(item: ApprovalListItem): string {
  const operationType = readStringField(item.approval.afterJson, "operationType") ?? item.approval.objectType;
  if (item.approval.action === "ai_paid_generation") {
    if (operationType === "image_generation") {
      return "이미지 소재 생성 승인";
    }
    if (operationType === "video_generation") {
      return "영상 소재 생성 승인";
    }
    if (operationType === "variant_batch") {
      return "소재 변형 생성 승인";
    }
    return "AI 소재 생성 승인";
  }
  return formatAction(item.approval.action);
}

function formatApprovalSubtitle(item: ApprovalListItem): string {
  if (item.approval.action !== "ai_paid_generation") {
    return formatObject(item.approval.objectType, item.approval.objectId);
  }
  const afterJson = item.approval.afterJson ?? {};
  const generationContext = readRecord(afterJson.generationContext);
  const prompt = readStringField(generationContext, "prompt") ?? readStringField(afterJson, "prompt");
  const provider = readStringField(afterJson, "providerName");
  const cost = readNumberField(afterJson, "estimatedCostKrw");
  const parts = [
    provider ? `제공자 ${provider}` : undefined,
    cost !== undefined ? `예상 ${Math.round(cost).toLocaleString("ko-KR")}원` : undefined,
    prompt ? trimLabel(prompt, 44) : undefined
  ].filter((value): value is string => Boolean(value));
  return parts.length > 0 ? parts.join(" - ") : item.approval.objectId ?? item.approval.objectType;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function readStringField(value: unknown, key: string): string | undefined {
  const record = readRecord(value);
  const raw = record?.[key];
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readNumberField(value: unknown, key: string): number | undefined {
  const record = readRecord(value);
  const raw = record?.[key];
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === "string") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function trimLabel(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function formatApiError(error: ApprovalListResponse["error"] | undefined, status: number): string {
  if (typeof error?.message === "string" && error.message.trim().length > 0) {
    return error.message;
  }
  const code = error?.code ?? `HTTP_${status}`;
  const labels: Record<string, string> = {
    REQUEST_FAILED: "요청을 처리하지 못했습니다. 다시 시도하고 계속 실패하면 설정과 서버 로그를 확인해야 합니다.",
    SELF_APPROVAL_NOT_ALLOWED: "본인이 요청한 고위험 승인 요청은 직접 승인할 수 없습니다.",
    APPROVAL_NOT_PENDING: "이미 처리된 승인 요청입니다. 목록을 새로고침한 뒤 다시 확인하세요.",
    APPROVAL_NOT_FOUND: "승인 요청을 찾을 수 없습니다. 목록을 새로고침하세요.",
    APPROVAL_EXPIRED: "승인 요청이 만료되었습니다. 소재 생성에서 다시 요청하세요.",
    TYPED_CONFIRMATION_REQUIRED: "입력 확인 문구가 필요하거나 일치하지 않습니다.",
    SUPABASE_AUTH_REQUIRED: "로그인 세션이 필요합니다. 다시 로그인하세요.",
    AUTH_REQUIRED: "로그인 세션이 필요합니다. 다시 로그인하세요.",
    TENANT_ACCESS_DENIED: "현재 계정으로 이 테넌트 승인 요청에 접근할 수 없습니다.",
    PAID_OPERATION_APPROVAL_REQUIRED: "승인된 유료 생성 요청이 필요합니다.",
    APPROVAL_REQUIRED: "승인 요청이 아직 실행 가능한 상태가 아닙니다.",
    PAID_GENERATION_WORKER_NOT_CONFIGURED: "유료 생성 provider 또는 worker 설정이 아직 완료되지 않았습니다.",
    PAID_IMAGE_GENERATION_NOT_CONFIGURED: "이미지 생성 provider 설정이 아직 완료되지 않았습니다.",
    PAID_VIDEO_GENERATION_NOT_CONFIGURED: "영상 생성 provider 설정이 아직 완료되지 않았습니다."
  };
  return labels[code] ?? code;
}

async function createTenantHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  const tenantId = readTenantId();
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

function formatAction(action: string): string {
  const labels: Record<string, string> = {
    meta_activate_campaign: "메타 캠페인 활성화",
    meta_activate_adset: "메타 광고 세트 활성화",
    meta_activate_ad: "메타 광고 활성화",
    meta_pause_campaign: "메타 캠페인 일시정지",
    meta_pause_adset: "메타 광고 세트 일시정지",
    meta_pause_ad: "메타 광고 일시정지",
    meta_delete_ad: "메타 광고 삭제",
    meta_create_ad_paused: "PAUSED 광고 초안 생성",
    meta_disconnect_connection: "메타 연결 해제",
    tenant_data_deletion: "테넌트 데이터 삭제",
    ai_paid_generation: "유료 AI 생성"
  };
  return labels[action] ?? action.replaceAll("_", " ");
}

function formatObject(objectType: string, objectId: string | undefined): string {
  return objectId ? `${objectType}:${objectId}` : objectType;
}

function formatDate(value: string | undefined): string {
  if (!value) {
    return "사용 불가";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toISOString();
}

function getLoadMessage(status: LoadStatus, error: string | null): string {
  if (status === "loading") {
    return "테넌트 승인 대기열을 불러오는 중입니다.";
  }
  if (status === "loaded") {
    return "서버에서 테넌트 승인 요청을 불러왔습니다.";
  }
  if (status === "empty") {
    return "대기 중인 승인 요청이 없습니다.";
  }
  return `승인 목록이 차단됐습니다: ${error ?? "UNKNOWN_ERROR"}.`;
}

function getDecisionTone(status: DecisionStatus, confirmationMatched: boolean): "ready" | "blocked" {
  if (status === "blocked" || !confirmationMatched) {
    return "blocked";
  }
  return "ready";
}

function getDecisionMessage(status: DecisionStatus, error: string | null, guardCode: string): string {
  if (status === "submitting") {
    return "승인 결정을 제출하는 중입니다.";
  }
  if (status === "succeeded") {
    return "승인 결정이 기록됐습니다.";
  }
  if (status === "blocked") {
    return error ?? "APPROVAL_DECISION_BLOCKED";
  }
  return guardCode;
}

function getReadinessStatus(item: ApprovalListItem): ReadinessStatus {
  const { approval, guard } = item;

  if (approval.status === "executed") {
    return {
      tone: "blocked",
      label: "작업 준비 상태",
      reason: "이미 완료됨"
    };
  }

  if (approval.status === "rejected" || approval.status === "cancelled" || approval.status === "expired") {
    return {
      tone: "blocked",
      label: "작업 준비 상태",
      reason: `${formatApprovalStatus(approval.status)} 상태로 종료됨`
    };
  }

  if (approval.status !== "approved") {
    return {
      tone: "pending",
      label: "작업 준비 상태",
      reason: "승인 대기 중"
    };
  }

  if (guard.requiresSecondApproval && !approval.secondApprovedBy) {
    return {
      tone: "pending",
      label: "작업 준비 상태",
      reason: "2차 승인 대기 중"
    };
  }

  if (approval.action === "ai_paid_generation") {
    return {
      tone: "pending",
      label: "작업 준비 상태",
      reason: "전용 도메인 경로 필요"
    };
  }

  return {
    tone: "ready",
    label: "작업 준비 상태",
    reason: "서버 실행기 준비 완료"
  };
}

function formatApprovalStatus(status: string): string {
  const labels: Record<string, string> = {
    pending: "대기",
    approved: "승인됨",
    rejected: "거절됨",
    executed: "실행됨",
    cancelled: "취소됨",
    expired: "만료됨"
  };
  return labels[status] ?? status;
}
