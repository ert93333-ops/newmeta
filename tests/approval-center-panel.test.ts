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

  it("does not add client-side execution, budget mutation, or credential exposure", () => {
    expect(panelSource).not.toMatch(/daily_budget|lifetime_budget|budgetMutation|BUDGET_MUTATION/);
    expect(panelSource).not.toContain("encryptedAccessToken");
    expect(panelSource).not.toContain("console.");
    expect(panelSource).not.toMatch(/<input[^>]+(?:name|id|placeholder|aria-label)=["'][^"']*(token|secret)/iu);
    expect(pageSource).toContain("ApprovalCenterPanel");
  });
});
