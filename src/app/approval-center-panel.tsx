"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, ShieldAlert, XCircle } from "lucide-react";

type ApprovalPreview = {
  id: string;
  title: string;
  object: string;
  riskLabel: string;
  action: string;
  requestedBy: string;
  status: string;
  requiredText?: string;
  requiresSecondApproval: boolean;
};

const approvalPreviews: ApprovalPreview[] = [
  {
    id: "publish-ad",
    title: "ACTIVE 전환",
    object: "instagram_reels_ad_2048",
    riskLabel: "Publish",
    action: "meta_activate_ad",
    requestedBy: "marketer",
    status: "확인 문구 대기",
    requiredText: "APPROVE meta_activate_ad",
    requiresSecondApproval: false
  },
  {
    id: "delete-ad",
    title: "광고 삭제",
    object: "facebook_feed_ad_1977",
    riskLabel: "Destructive",
    action: "meta_delete_ad",
    requestedBy: "admin",
    status: "2차 승인 필요",
    requiredText: "APPROVE meta_delete_ad",
    requiresSecondApproval: true
  },
  {
    id: "paused-draft",
    title: "PAUSED Draft 생성",
    object: "spring_offer_variant_a",
    riskLabel: "Draft",
    action: "meta_create_ad_paused",
    requestedBy: "marketer",
    status: "승인 가능",
    requiresSecondApproval: false
  }
];

export function ApprovalCenterPanel() {
  const [selectedId, setSelectedId] = useState(approvalPreviews[0]?.id ?? "");
  const [typedConfirmation, setTypedConfirmation] = useState("");
  const selected = useMemo(
    () => approvalPreviews.find((approval) => approval.id === selectedId) ?? approvalPreviews[0],
    [selectedId]
  );
  const requiredText = selected?.requiredText;
  const isMatched = requiredText ? typedConfirmation.trim() === requiredText : true;
  const guardCode = requiredText && !isMatched ? "TYPED_CONFIRMATION_REQUIRED" : "READY";

  return (
    <section className="panel approval-panel" id="approval-center">
      <div className="panel-heading">
        <div>
          <h2>Approval Center</h2>
          <p className="muted">서버 guard 동기화됨</p>
        </div>
        <span className="tag warn">typed confirmation</span>
      </div>

      <div className="approval-layout">
        <div className="approval-list" aria-label="Approval requests">
          {approvalPreviews.map((approval) => (
            <button
              className={`approval-row ${approval.id === selected?.id ? "selected" : ""}`}
              key={approval.id}
              onClick={() => {
                setSelectedId(approval.id);
                setTypedConfirmation("");
              }}
              type="button"
            >
              <span>
                <strong>{approval.title}</strong>
                <small>
                  {approval.object} · {approval.status}
                </small>
              </span>
              <span className={`risk-chip ${approval.riskLabel.toLowerCase()}`}>{approval.riskLabel}</span>
            </button>
          ))}
        </div>

        {selected ? (
          <form className="approval-form" onSubmit={(event) => event.preventDefault()}>
            <div className="approval-form-head">
              <ShieldAlert aria-hidden="true" size={20} />
              <div>
                <strong>{selected.action}</strong>
                <small>
                  요청자 {selected.requestedBy}
                  {selected.requiresSecondApproval ? " · 2차 승인 필요" : ""}
                </small>
              </div>
            </div>

            <label className="field">
              <span>확인 문구</span>
              <code>{requiredText ?? "필요 없음"}</code>
              <input
                aria-label="Typed confirmation"
                disabled={!requiredText}
                onChange={(event) => setTypedConfirmation(event.target.value)}
                placeholder={requiredText ?? "Draft 액션은 typed confirmation 없음"}
                value={typedConfirmation}
              />
            </label>

            <div className={`guard-state ${isMatched ? "ready" : "blocked"}`} role="status">
              {isMatched ? <CheckCircle2 aria-hidden="true" size={18} /> : <XCircle aria-hidden="true" size={18} />}
              <span>{guardCode}</span>
            </div>

            <button className="approve-button" disabled={!isMatched} type="submit">
              <CheckCircle2 aria-hidden="true" size={18} />
              승인 요청 전송
            </button>
          </form>
        ) : null}
      </div>
    </section>
  );
}
