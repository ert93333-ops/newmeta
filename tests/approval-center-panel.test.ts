import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const panelSource = readFileSync(join(process.cwd(), "src", "app", "approval-center-panel.tsx"), "utf8");
const pageSource = readFileSync(join(process.cwd(), "src", "app", "page.tsx"), "utf8");

describe("Approval center panel", () => {
  it("loads tenant-scoped approvals from the server with browser auth context", () => {
    expect(panelSource).toContain("/api/approvals");
    expect(panelSource).toContain("createSupabaseBrowserClient");
    expect(panelSource).toContain("headers.authorization");
    expect(panelSource).toContain('"x-tenant-id"');
    expect(panelSource).toContain("hermes:tenant-id");
  });

  it("refreshes and selects new approvals created from other app panels", () => {
    expect(panelSource).toContain("hermes:approval-created");
    expect(panelSource).toContain("readApprovalCreatedId");
    expect(panelSource).toContain("setSelectedId(approvalId)");
  });

  it("renders server guard metadata instead of recomputing or mocking approval policy", () => {
    expect(panelSource).toContain("item.approval.id");
    expect(panelSource).toContain("guard.requiredText");
    expect(panelSource).toContain("guard.requiresSecondApproval");
    expect(panelSource).toContain("guard.expiresAt");
    expect(panelSource).toContain("secondApprovedBy");
    expect(panelSource).not.toContain("approvalPreviews");
    expect(panelSource).not.toContain("publish-ad");
    expect(panelSource).not.toContain("delete-ad");
    expect(panelSource).not.toContain("paused-draft");
  });

  it("submits only approve or reject decisions through server approval routes", () => {
    expect(panelSource).toContain('method: "POST"');
    expect(panelSource).toContain("typedConfirmation");
    expect(panelSource).toContain("rejectionReason");
    expect(panelSource).toContain("Content-Type");
    expect(panelSource).toContain("/api/approvals/${selected.approval.id}/${decision}");
    expect(panelSource).not.toContain("/execute");
  });

  it("queues approved paid generation through the render domain route", () => {
    expect(panelSource).toContain("생성 작업 시작");
    expect(panelSource).toContain("canQueueGeneration");
    expect(panelSource).toContain("queueApprovedGeneration");
    expect(panelSource).toContain("/api/render/jobs");
    expect(panelSource).toContain("approvalRequestId: item.approval.id");
    expect(panelSource).toContain("generationContext");
    expect(panelSource).toContain("hermes:generation-job-queued");
    expect(panelSource).not.toContain("/api/approvals/${selected.approval.id}/execute");
  });

  it("labels paid generation approvals by media type and human-readable context", () => {
    expect(panelSource).toContain("formatApprovalTitle");
    expect(panelSource).toContain("이미지 소재 생성 승인");
    expect(panelSource).toContain("영상 소재 생성 승인");
    expect(panelSource).toContain("formatApprovalSubtitle");
    expect(panelSource).toContain("estimatedCostKrw");
  });

  it("maps approval API failures to operator-readable Korean messages", () => {
    expect(panelSource).toContain("formatApiError");
    expect(panelSource).toContain("본인이 요청한 고위험 승인 요청은 직접 승인할 수 없습니다.");
    expect(panelSource).toContain("이미 처리된 승인 요청입니다.");
    expect(panelSource).toContain("요청을 처리하지 못했습니다.");
  });

  it("shows read-only action readiness without dispatching execution", () => {
    expect(panelSource).toContain("getReadinessStatus");
    expect(panelSource).toContain("2차 승인 대기 중");
    expect(panelSource).toContain("전용 도메인 경로 필요");
    expect(panelSource).toContain("서버 실행기 준비 완료");
    expect(panelSource).toContain("readiness-state");
    expect(panelSource).not.toContain("executeApprovedAction");
  });

  it("does not add client-side execution, budget mutation, or credential exposure", () => {
    expect(panelSource).not.toMatch(/daily_budget|lifetime_budget|budgetMutation|BUDGET_MUTATION/);
    expect(panelSource).not.toContain("encryptedAccessToken");
    expect(panelSource).not.toContain("console.");
    expect(panelSource).not.toMatch(/<input[^>]+(?:name|id|placeholder|aria-label)=["'][^"']*(token|secret)/iu);
    expect(pageSource).toContain("ApprovalCenterPanel");
  });
});
