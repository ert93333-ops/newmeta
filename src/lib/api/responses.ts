import { NextResponse } from "next/server";
import { isTypedConfirmationRequiredError } from "@/lib/approval/approval-policy";
import { assertNoBudgetMutation, isBudgetMutationBlockedError } from "@/lib/guards/budget-guard";
import {
  assertNoCredentialPayload,
  isCredentialPayloadBlockedError,
  redactCredentialPayload
} from "@/lib/guards/credential-guard";

export function ok<T>(data: T, status = 200): NextResponse<T> {
  return NextResponse.json(redactCredentialPayload(data) as T, { status });
}

export function fail(code: string, message: string, status = 400, details?: unknown): NextResponse {
  return NextResponse.json(
    redactCredentialPayload({
      error: {
        code,
        message,
        details
      }
    }),
    { status }
  );
}

export async function parseJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text) {
    return {};
  }
  return JSON.parse(text);
}

export async function parseWriteJson(request: Request): Promise<unknown> {
  const body = await parseJson(request);
  assertNoBudgetMutation(body);
  assertNoCredentialPayload(body);
  return body;
}

export function handleError(error: unknown): NextResponse {
  if (isBudgetMutationBlockedError(error)) {
    return fail(error.code, error.message, 403, { paths: error.paths });
  }
  if (isCredentialPayloadBlockedError(error)) {
    return fail(error.code, error.message, 403, { paths: error.paths });
  }
  if (isTypedConfirmationRequiredError(error)) {
    return fail("TYPED_CONFIRMATION_REQUIRED", "위험 액션 승인을 위한 명시 확인 문구가 필요합니다.", 403, {
      requiredText: error.requiredText
    });
  }
  if (error instanceof Error) {
    if (error.message === "AUTH_REQUIRED" || error.message === "SUPABASE_AUTH_REQUIRED") {
      return fail(error.message, "Authentication is required.", 401);
    }
    if (error.message === "MOCK_AUTH_DISABLED_IN_PRODUCTION") {
      return fail(error.message, "Mock authentication is disabled in production.", 401);
    }
    if (error.message === "MOCK_EXECUTION_DISABLED_IN_PRODUCTION") {
      return fail(error.message, "Mock approval execution is disabled in production.", 501);
    }
    if (error.message === "LIVE_APPROVAL_EXECUTOR_NOT_CONFIGURED") {
      return fail(error.message, "Live approval execution is not configured.", 501);
    }
    if (error.message === "TENANT_REQUIRED") {
      return fail(error.message, "Tenant context is required.", 400);
    }
    if (error.message === "APPROVAL_REQUIRED" || error.message === "SECOND_APPROVAL_REQUIRED") {
      return fail(error.message, "승인 후 실행할 수 있습니다.", 403);
    }
    if (error.message === "APPROVAL_EXPIRED") {
      return fail(error.message, "Approval request has expired.", 403);
    }
    if (error.message.endsWith("_ACCESS_DENIED")) {
      return fail(error.message, "권한이 없습니다.", 403);
    }
    return fail("REQUEST_FAILED", error.message, 400);
  }
  return fail("UNKNOWN_ERROR", "알 수 없는 오류가 발생했습니다.", 500);
}
