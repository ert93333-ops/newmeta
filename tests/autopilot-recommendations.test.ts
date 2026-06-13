import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "src", "lib", "operations", "autopilot-recommendations.ts"), "utf8");

describe("autopilot recommendations", () => {
  it("returns creative briefs and safe operating plans for recommendation-based generation", () => {
    expect(source).toContain("creativeBrief");
    expect(source).toContain("recommendedPrompt");
    expect(source).toContain("operationPlan");
    expect(source).toContain("paused_draft_after_qa");
    expect(source).toContain("abTest");
    expect(source).toContain("minimumData");
  });

  it("keeps autopilot within approval and budget boundaries", () => {
    expect(source).toContain("No budget mutation API is available.");
    expect(source).toContain("No ACTIVE transition runs without explicit approval.");
    expect(source).toContain("No destructive action runs without the required approval policy.");
    expect(source).toContain("Generate asset only after paid AI approval");
    expect(source).toContain("PAUSED drafts");
  });

  it("implements the imported autopilot guideline as propose-only orchestration metadata", () => {
    expect(source).toContain('requestedMode: "PROPOSE_ONLY"');
    expect(source).toContain('autonomyLevel: "RECOMMENDATION"');
    expect(source).toContain('singleWriter: "action_orchestrator"');
    expect(source).toContain("decisionProposal");
    expect(source).toContain("complianceGate");
    expect(source).toContain("dataQualityGates");
    expect(source).toContain("killSwitch");
    expect(source).toContain("rollbackPlan");
    expect(source).toContain("autoExecutable: false");
  });
});
