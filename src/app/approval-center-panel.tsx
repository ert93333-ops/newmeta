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

type GeneratedAssetSummary = {
  id: string;
  assetType?: string;
  sourceUrl?: string;
  width?: number;
  height?: number;
  mimeType?: string;
  metadataJson?: Record<string, unknown>;
};

type GenerationJobSummary = {
  id: string;
  status?: string;
  type?: string;
  result?: Record<string, unknown>;
  input?: Record<string, unknown>;
};

type DraftSummary = {
  id: string;
  assetId?: string;
  approvalRequestId?: string;
  metaAdId?: string;
  metaStatus: string;
  createdAt?: string;
  payloadJson?: Record<string, unknown>;
};

type JobResponse = {
  job?: GenerationJobSummary;
  error?: ApprovalListResponse["error"];
};

type DraftListResponse = {
  drafts?: DraftSummary[];
  error?: ApprovalListResponse["error"];
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
const GENERATION_JOB_STORAGE_KEY = "hermes:generation-job-ids";

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
  const [generationJobs, setGenerationJobs] = useState<GenerationJobSummary[]>([]);
  const [jobStatus, setJobStatus] = useState<DecisionStatus>("idle");
  const [jobError, setJobError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [draftStatus, setDraftStatus] = useState<DecisionStatus>("idle");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftForm, setDraftForm] = useState({
    adAccountId: "",
    pageId: "",
    linkUrl: "",
    primaryText: "",
    headline: "",
    description: "",
    callToActionType: "SHOP_NOW"
  });

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

  const loadGenerationJobs = useCallback(async (jobIds = readStoredGenerationJobIds()) => {
    if (jobIds.length === 0) {
      setGenerationJobs([]);
      return;
    }
    setJobStatus("submitting");
    setJobError(null);
    const headers = await createTenantHeaders();
    const loaded: GenerationJobSummary[] = [];
    for (const jobId of jobIds.slice(0, 8)) {
      const response = await fetch(`/api/jobs/${jobId}`, { headers });
      const body = (await response.json()) as JobResponse;
      if (response.ok && body.job) {
        loaded.push(body.job);
      } else if (response.status !== 404) {
        setJobError(formatApiError(body.error, response.status));
      }
    }
    setGenerationJobs(loaded);
    setJobStatus("succeeded");
  }, []);

  const loadDrafts = useCallback(async () => {
    const response = await fetch("/api/drafts", { headers: await createTenantHeaders() });
    const body = (await response.json()) as DraftListResponse;
    if (!response.ok) {
      setDraftError(formatApiError(body.error, response.status));
      return;
    }
    setDrafts(body.drafts ?? []);
  }, []);

  useEffect(() => {
    void loadGenerationJobs();
    void loadDrafts();
  }, [loadDrafts, loadGenerationJobs]);

  useEffect(() => {
    function handleGenerationJobQueued(event: Event) {
      const jobId = readGenerationJobQueuedId(event);
      if (!jobId) {
        return;
      }
      const nextIds = storeGenerationJobId(jobId);
      void loadGenerationJobs(nextIds);
    }

    window.addEventListener("hermes:generation-job-queued", handleGenerationJobQueued);
    return () => {
      window.removeEventListener("hermes:generation-job-queued", handleGenerationJobQueued);
    };
  }, [loadGenerationJobs]);

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

  async function requestPausedDraft(asset: GeneratedAssetSummary) {
    setDraftStatus("submitting");
    setDraftError(null);
    const response = await fetch("/api/drafts/create-paused", {
      method: "POST",
      headers: {
        ...(await createTenantHeaders()),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        assetId: asset.id,
        adAccountId: draftForm.adAccountId,
        pageId: draftForm.pageId,
        linkUrl: draftForm.linkUrl,
        manifest: {
          asset: {
            id: asset.id,
            type: asset.assetType === "video" ? "video" : "image",
            width: asset.width ?? 1080,
            height: asset.height ?? 1350,
            mimeType: asset.mimeType
          },
          textBoxes: [],
          primaryText: draftForm.primaryText,
          headline: draftForm.headline,
          description: draftForm.description,
          linkUrl: draftForm.linkUrl,
          placements: ["facebook_feed", "instagram_feed", "instagram_stories"]
        },
        payload: {
          creativeName: `Hermes 생성 소재 ${asset.id}`,
          adName: `Hermes PAUSED 초안 ${asset.id}`,
          pageId: draftForm.pageId,
          linkUrl: draftForm.linkUrl,
          message: draftForm.primaryText,
          headline: draftForm.headline,
          description: draftForm.description,
          callToActionType: draftForm.callToActionType,
          objective: "OUTCOME_SALES"
        },
        reason: "생성된 AI 소재를 검수 후 PAUSED Meta 광고 초안으로 등록하기 위한 승인 요청입니다."
      })
    });
    const body = (await response.json()) as { approval?: ApprovalSummary; error?: ApprovalListResponse["error"] };
    if (!response.ok) {
      setDraftStatus("blocked");
      setDraftError(formatApiError(body.error, response.status));
      return;
    }
    setDraftStatus("succeeded");
    if (body.approval?.id) {
      window.dispatchEvent(new CustomEvent("hermes:approval-created", { detail: { approvalId: body.approval.id } }));
    }
    await loadApprovals();
    await loadDrafts();
  }

  async function requestPublishApproval(draft: DraftSummary) {
    if (!draft.metaAdId) {
      setDraftStatus("blocked");
      setDraftError("Meta 광고 ID가 있는 PAUSED 초안만 개시 승인 요청을 만들 수 있습니다.");
      return;
    }
    setDraftStatus("submitting");
    setDraftError(null);
    const response = await fetch("/api/approvals", {
      method: "POST",
      headers: {
        ...(await createTenantHeaders()),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "meta_activate_ad",
        objectType: "ad",
        objectId: draft.metaAdId,
        beforeJson: { status: draft.metaStatus, draftId: draft.id },
        afterJson: { status: "ACTIVE", draftId: draft.id, metaAdId: draft.metaAdId },
        reason: "검수 완료된 PAUSED 초안을 실제 광고로 개시하기 위한 승인 요청입니다. 예산 변경은 포함하지 않습니다."
      })
    });
    const body = (await response.json()) as { approval?: ApprovalSummary; error?: ApprovalListResponse["error"] };
    if (!response.ok) {
      setDraftStatus("blocked");
      setDraftError(formatApiError(body.error, response.status));
      return;
    }
    setDraftStatus("succeeded");
    if (body.approval?.id) {
      window.dispatchEvent(new CustomEvent("hermes:approval-created", { detail: { approvalId: body.approval.id } }));
    }
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
              <strong>{formatApprovalReasonBrief(selected.approval.reason)}</strong>
              <span>2차 승인</span>
              <strong>{selected.approval.secondApprovedBy ? "완료" : selected.guard.requiresSecondApproval ? "필수" : "필요 없음"}</strong>
            </div>

            <ApprovalReasonSummary reason={selected.approval.reason} afterJson={selected.approval.afterJson} />

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

      <div className="generation-results-panel">
        <div className="section-title-row compact">
          <h3>생성 결과와 초안</h3>
          <div className="approval-actions compact">
            <button className="reject-button slim" onClick={() => void loadGenerationJobs()} type="button">
              생성 결과 새로고침
            </button>
            <button className="reject-button slim" onClick={() => void loadDrafts()} type="button">
              초안 새로고침
            </button>
          </div>
        </div>

        <div className="draft-input-grid">
          <label className="field">
            <span>Meta 광고 계정 ID</span>
            <input
              onChange={(event) => setDraftForm((current) => ({ ...current, adAccountId: event.target.value }))}
              placeholder="act_..."
              value={draftForm.adAccountId}
            />
          </label>
          <label className="field">
            <span>페이지 ID</span>
            <input
              onChange={(event) => setDraftForm((current) => ({ ...current, pageId: event.target.value }))}
              placeholder="Meta Page ID"
              value={draftForm.pageId}
            />
          </label>
          <label className="field">
            <span>랜딩 URL</span>
            <input
              onChange={(event) => setDraftForm((current) => ({ ...current, linkUrl: event.target.value }))}
              placeholder="https://..."
              type="url"
              value={draftForm.linkUrl}
            />
          </label>
          <label className="field">
            <span>CTA</span>
            <input
              onChange={(event) => setDraftForm((current) => ({ ...current, callToActionType: event.target.value }))}
              value={draftForm.callToActionType}
            />
          </label>
        </div>
        <div className="draft-input-grid">
          <label className="field">
            <span>본문</span>
            <textarea
              onChange={(event) => setDraftForm((current) => ({ ...current, primaryText: event.target.value }))}
              placeholder="광고 본문"
              value={draftForm.primaryText}
            />
          </label>
          <label className="field">
            <span>헤드라인</span>
            <textarea
              onChange={(event) => setDraftForm((current) => ({ ...current, headline: event.target.value }))}
              placeholder="광고 헤드라인"
              value={draftForm.headline}
            />
          </label>
          <label className="field">
            <span>설명</span>
            <textarea
              onChange={(event) => setDraftForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="광고 설명"
              value={draftForm.description}
            />
          </label>
        </div>

        <div className="generated-asset-grid">
          {generationJobs.length === 0 ? (
            <div className="approval-empty" role="status">
              <span>아직 이 브라우저에서 추적 중인 생성 작업이 없습니다.</span>
            </div>
          ) : null}
          {generationJobs.map((job) => (
            <article className="generated-job-card" key={job.id}>
              <div>
                <strong>{formatJobTitle(job)}</strong>
                <small>{formatJobStatus(job.status)}</small>
              </div>
              <p>{formatJobSummary(job)}</p>
              <div className="generated-asset-list">
                {extractGeneratedAssets(job).map((asset) => (
                  <div className="generated-asset-card" key={asset.id}>
                    {asset.sourceUrl && asset.assetType !== "video" ? (
                      <img alt="생성된 광고 소재 미리보기" src={asset.sourceUrl} />
                    ) : (
                      <div className="generated-asset-placeholder">{asset.assetType ?? "asset"}</div>
                    )}
                    <div>
                      <strong>{formatGeneratedAssetLabel(asset)}</strong>
                      <small>{asset.width ?? "?"} x {asset.height ?? "?"}</small>
                      <button
                        className="approve-button secondary"
                        disabled={!canRequestDraft(draftForm) || draftStatus === "submitting"}
                        onClick={() => void requestPausedDraft(asset)}
                        type="button"
                      >
                        PAUSED 초안 승인 요청
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>

        <div className="generated-asset-grid">
          {drafts.map((draft) => (
            <article className="generated-job-card" key={draft.id}>
              <div>
                <strong>PAUSED 초안 {draft.metaAdId ?? draft.id}</strong>
                <small>{draft.metaStatus}</small>
              </div>
              <p>검수 완료 후 개시하려면 여기서 ACTIVE 전환 승인 요청을 만들고 승인 센터에서 실행합니다. 예산 변경은 포함하지 않습니다.</p>
              <button
                className="approve-button"
                disabled={draftStatus === "submitting" || draft.metaStatus !== "PAUSED" || !draft.metaAdId}
                onClick={() => void requestPublishApproval(draft)}
                type="button"
              >
                개시 승인 요청
              </button>
            </article>
          ))}
        </div>

        <p className="settings-message">
          {draftStatus !== "idle" ? getDecisionMessage(draftStatus, draftError, draftStatus) : null}
          {jobStatus === "blocked" ? jobError : null}
        </p>
      </div>
    </section>
  );
}

function ApprovalReasonSummary({
  reason,
  afterJson
}: {
  reason?: string;
  afterJson?: Record<string, unknown>;
}) {
  const summary = summarizeApprovalReason(reason, afterJson);
  return (
    <div className="approval-reason-summary">
      <div>
        <span>왜 만들까요</span>
        <strong>{summary.why}</strong>
      </div>
      <div>
        <span>무엇을 유지하나요</span>
        <strong>{summary.keep}</strong>
      </div>
      <div>
        <span>무엇만 바꾸나요</span>
        <strong>{summary.change}</strong>
      </div>
      <div>
        <span>검수 기준</span>
        <strong>{summary.qa}</strong>
      </div>
      <div>
        <span>다음 단계</span>
        <strong>{summary.next}</strong>
      </div>
      <div>
        <span>자동화 경계</span>
        <strong>{summary.boundary}</strong>
      </div>
    </div>
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

function readGenerationJobQueuedId(event: Event): string | undefined {
  if (!("detail" in event) || !event.detail || typeof event.detail !== "object") {
    return undefined;
  }
  const detail = event.detail as { jobId?: unknown };
  return typeof detail.jobId === "string" && detail.jobId.length > 0 ? detail.jobId : undefined;
}

function readStoredGenerationJobIds(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(GENERATION_JOB_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}

function storeGenerationJobId(jobId: string): string[] {
  const nextIds = [jobId, ...readStoredGenerationJobIds().filter((value) => value !== jobId)].slice(0, 8);
  try {
    window.localStorage.setItem(GENERATION_JOB_STORAGE_KEY, JSON.stringify(nextIds));
  } catch {
    // Browser storage is optional; the current in-memory state still updates.
  }
  return nextIds;
}

function canQueueGeneration(item: ApprovalListItem): boolean {
  return item.approval.action === "ai_paid_generation" && item.approval.status === "approved";
}

function canRequestDraft(form: { adAccountId: string; pageId: string; linkUrl: string }): boolean {
  return form.adAccountId.trim().length > 0 && form.pageId.trim().length > 0 && form.linkUrl.trim().length > 0;
}

function extractGeneratedAssets(job: GenerationJobSummary): GeneratedAssetSummary[] {
  const resultAssets = readArray(readRecord(job.result)?.generatedAssets);
  return resultAssets
    .map((item) => readRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      id: readStringField(item, "id") ?? readStringField(item, "assetId") ?? "generated-asset",
      assetType: readStringField(item, "assetType"),
      sourceUrl: readStringField(item, "sourceUrl"),
      width: readNumberField(item, "width"),
      height: readNumberField(item, "height"),
      mimeType: readStringField(item, "mimeType"),
      metadataJson: readRecord(item.metadataJson)
    }));
}

function formatGeneratedAssetLabel(asset: GeneratedAssetSummary): string {
  if (asset.assetType === "video") {
    return "생성 영상 소재";
  }
  return "생성 이미지 소재";
}

function formatJobTitle(job: GenerationJobSummary): string {
  if (job.type === "video_generation") {
    return "영상 생성 작업";
  }
  return "이미지 생성 작업";
}

function formatJobStatus(status: string | undefined): string {
  const labels: Record<string, string> = {
    queued: "대기 중",
    running: "생성 중",
    succeeded: "완료",
    failed: "실패"
  };
  return labels[status ?? ""] ?? status ?? "상태 확인 중";
}

function formatJobSummary(job: GenerationJobSummary): string {
  const assets = extractGeneratedAssets(job);
  if (assets.length > 0) {
    return `${assets.length}개의 생성 소재가 저장됐습니다. 필요한 항목을 선택해 PAUSED 초안 승인 요청을 만들 수 있습니다.`;
  }
  if (job.status === "queued" || job.status === "running") {
    return "worker가 provider 생성 결과를 저장하면 이 영역에 미리보기와 초안 등록 버튼이 표시됩니다.";
  }
  return "아직 저장된 생성 소재가 없습니다. worker 실행 상태와 provider 설정을 확인하세요.";
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

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
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

function formatApprovalReasonBrief(reason: string | undefined): string {
  const summary = summarizeApprovalReason(reason);
  return `${summary.why} / ${summary.change}`;
}

function summarizeApprovalReason(reason: string | undefined, afterJson?: Record<string, unknown>) {
  const text = reason ?? "";
  const generationContext = readRecord(afterJson?.generationContext);
  const prompt = readStringField(generationContext, "prompt");
  const best = matchReason(text, /성과 근거:\s*([^\n]+)/);
  const keep = matchReason(text, /유지:\s*([^\n]+)/);
  const improve = matchReason(text, /개선:\s*([^\n]+)/);
  const direction = matchReason(text, /생성 방향:\s*([^\n]+)/);
  const product = matchReason(text, /상품 추출:\s*([^\n]+)/);
  const abTest = matchReason(text, /A\/B 테스트 계획:\s*([^\n]+)/);

  return {
    why: simplifyReason(best) ?? "기존 성과 데이터를 근거로 새 소재 후보를 만들기 위한 요청입니다.",
    keep: simplifyReason(keep) ?? "검증된 오퍼, 랜딩 URL, 타겟 맥락은 그대로 유지합니다.",
    change: simplifyReason(direction ?? improve) ?? "소재 각도 한 가지만 바꾼 통제 변형을 만듭니다.",
    qa: simplifyReason(product) ?? "생성 결과는 안전영역, 가격 정확성, 금지 문구, placement 호환성 검수 후 초안으로만 등록합니다.",
    next:
      simplifyReason(abTest) ??
      "생성된 소재를 확인한 뒤 PAUSED 초안 승인 요청을 만들고, 개시는 별도 승인으로 진행합니다.",
    boundary:
      prompt && prompt.length > 0
        ? `예산 변경 없음, 자동 ACTIVE 전환 없음, 승인 후 실행. 프롬프트: ${trimLabel(prompt, 90)}`
        : "예산 변경 없음, 자동 ACTIVE 전환 없음, 모든 Meta write는 승인 후 실행."
  };
}

function matchReason(text: string, pattern: RegExp): string | undefined {
  const matched = text.match(pattern)?.[1]?.trim();
  return matched && matched.length > 0 ? matched : undefined;
}

function simplifyReason(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return value
    .replaceAll("No high-risk bottleneck condition is currently detected.", "현재 고위험 병목은 감지되지 않았습니다.")
    .replaceAll("Continue observation and prepare only controlled variants from stronger signals.", "관찰을 유지하고, 강한 신호에서만 통제 변형을 준비합니다.")
    .replaceAll("Generate one upload-ready creative from the recommended brief.", "추천 브리프로 업로드 가능한 소재 1개를 만듭니다.")
    .replaceAll("Run safe area, price accuracy, forbidden text, and placement compatibility checks.", "안전영역, 가격, 금지 문구, placement 호환성을 검사합니다.")
    .replaceAll("Create a PAUSED Meta draft with the validated asset and existing campaign/ad set context.", "검수된 소재를 기존 캠페인/광고세트 맥락의 PAUSED 초안으로 등록합니다.")
    .replaceAll("Route the draft through Approval Center before any publish or status change.", "게시나 상태 변경 전 승인센터를 거칩니다.")
    .replaceAll("Monitor Meta insights and keep budget changes recommendation-only.", "성과는 모니터링하고 예산 변경은 추천만 합니다.")
    .replaceAll("No budget mutation API is available.", "예산 변경 API는 없습니다.")
    .replaceAll("No ACTIVE transition runs without explicit approval.", "명시 승인 없이는 ACTIVE 전환하지 않습니다.")
    .replaceAll("No destructive action runs without the required approval policy.", "삭제/파괴적 작업은 필수 승인 없이는 실행하지 않습니다.")
    .replaceAll("All Meta write execution must go through the single-writer Action Orchestrator.", "Meta 쓰기 작업은 단일 실행 경로만 사용합니다.")
    .replaceAll("Generate asset only after paid AI approval; register Meta ads only as PAUSED drafts; ACTIVE requires separate approval.", "유료 AI 승인 후에만 생성하고, Meta 등록은 PAUSED 초안만 가능하며, ACTIVE는 별도 승인이 필요합니다.")
    .replace(/\s*->\s*/g, " → ")
    .trim();
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
