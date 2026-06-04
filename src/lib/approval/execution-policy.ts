import { isProductionRuntime } from "@/lib/api/context";
import type { ApprovalAction } from "@/lib/types";

export type ApprovalExecutionMode = "mock" | "live";

export interface ApprovalExecutionPlan {
  mode: ApprovalExecutionMode;
  result: string;
}

export function configuredApprovalExecutionMode(): ApprovalExecutionMode {
  return process.env.HERMES_APPROVAL_EXECUTION_MODE === "live" ? "live" : "mock";
}

export function planApprovalExecution(_action: ApprovalAction): ApprovalExecutionPlan {
  const mode = configuredApprovalExecutionMode();

  if (mode === "mock") {
    if (isProductionRuntime()) {
      throw new Error("MOCK_EXECUTION_DISABLED_IN_PRODUCTION");
    }
    return {
      mode,
      result: "mock_executed_server_side"
    };
  }

  throw new Error("LIVE_APPROVAL_EXECUTOR_NOT_CONFIGURED");
}
