import { NextResponse } from "next/server";
import {
  isApprovalActionDomainExecutorRequiredError,
  isPaidOperationDomainExecutorRequiredError
} from "@/lib/approval/execution-policy";
import { isTypedConfirmationRequiredError } from "@/lib/approval/approval-policy";
import {
  assertNoBudgetMutation,
  isBudgetMutationBlockedError
} from "@/lib/guards/budget-guard";
import { isPaidOperationApprovalRequiredError } from "@/lib/guards/cost-guard";
import {
  CostProviderRequiredError,
  CostSettingsInvalidError,
  CostSettingsNotConfiguredError
} from "@/lib/settings/cost-settings";
import { MetaGraphRequestError } from "@/lib/meta/graph-meta-adapter";
import { MetaRequiredScopesMissingError } from "@/lib/meta/oauth";
import {
  assertNoCredentialPayload,
  isCredentialPayloadBlockedError,
  redactCredentialPayload
} from "@/lib/guards/credential-guard";
import { isRateLimitExceededError } from "@/lib/security/rate-limit";

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
  if (isPaidOperationApprovalRequiredError(error)) {
    return fail(error.code, "Paid AI operations require an approved approval request before execution.", 403, {
      operationType: error.operationType
    });
  }
  if (error instanceof CostProviderRequiredError) {
    return fail(error.code, "Provider name is required for cost estimation.", 400);
  }
  if (error instanceof CostSettingsNotConfiguredError) {
    return fail(error.code, "Server cost settings are not configured for this provider.", 501, {
      providerName: error.providerName
    });
  }
  if (error instanceof CostSettingsInvalidError) {
    return fail(error.code, "Stored server cost settings are invalid for this provider.", 501, {
      providerName: error.providerName
    });
  }
  if (error instanceof MetaGraphRequestError) {
    return fail(
      error.code,
      "Meta Graph API request failed.",
      error.status >= 400 && error.status < 600 ? error.status : 502,
      {
        status: error.status,
        metaErrorType: error.metaErrorType,
        metaErrorCode: error.metaErrorCode,
        metaErrorSubcode: error.metaErrorSubcode,
        providerMessage: error.providerMessage
      }
    );
  }
  if (error instanceof MetaRequiredScopesMissingError) {
    return fail(error.message, "Meta OAuth did not grant all required scopes.", 403, {
      missingScopes: error.missingScopes
    });
  }
  if (isPaidOperationDomainExecutorRequiredError(error)) {
    return fail(
      error.code,
      "Paid AI operations must be executed by their domain route or worker so cost logging and output validation run together.",
      501,
      { action: error.action }
    );
  }
  if (isApprovalActionDomainExecutorRequiredError(error)) {
    return fail(
      error.code,
      "This approval action must be executed by its domain route so preflight, persistence, and external side effects stay in one path.",
      501,
      {
        action: error.action,
        route: error.route
      }
    );
  }
  if (isCredentialPayloadBlockedError(error)) {
    return fail(error.code, error.message, 403, { paths: error.paths });
  }
  if (isRateLimitExceededError(error)) {
    return fail(error.code, "Too many requests. Try again later.", 429, {
      retryAfterSeconds: error.retryAfterSeconds,
      limit: error.limit,
      windowMs: error.windowMs
    });
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
    if (error.message === "MOCK_META_OAUTH_DISABLED_IN_PRODUCTION") {
      return fail(error.message, "Mock Meta OAuth is disabled in production.", 501);
    }
    if (error.message === "MOCK_META_CONNECTION_DISABLED_IN_PRODUCTION") {
      return fail(error.message, "Mock Meta connections are disabled in production.", 501);
    }
    if (error.message === "LIVE_APPROVAL_EXECUTOR_NOT_CONFIGURED") {
      return fail(error.message, "Live approval execution is not configured.", 501);
    }
    if (error.message === "LIVE_APPROVAL_EXECUTOR_CONTEXT_REQUIRED") {
      return fail(error.message, "Live approval execution requires the route context and server-side Meta connection.", 501);
    }
    if (error.message === "APPROVAL_OBJECT_ID_REQUIRED") {
      return fail(error.message, "Approval execution requires a target object id.", 400);
    }
    if (error.message === "META_CONNECTION_REQUIRED") {
      return fail(error.message, "A live Meta connection is required for this operation.", 409);
    }
    if (error.message === "META_CONNECTION_NOT_FOUND") {
      return fail(error.message, "Meta connection was not found for this tenant.", 404);
    }
    if (error.message === "META_CONNECTION_EXPIRED") {
      return fail(error.message, "The stored Meta connection has expired and must be reconnected.", 409);
    }
    if (error.message === "META_ASSET_SOURCE_URL_REQUIRED") {
      return fail(error.message, "Live Meta draft execution requires a persisted public asset source URL.", 422);
    }
    if (error.message === "META_VIDEO_THUMBNAIL_REQUIRED") {
      return fail(error.message, "Live Meta video draft execution requires a thumbnailUrl preview image.", 422);
    }
    if (error.message === "META_TARGETING_REQUIRED") {
      return fail(error.message, "Live Meta draft execution requires non-empty ad set targeting.", 422);
    }
    if (error.message === "META_PROMOTED_OBJECT_REQUIRED") {
      return fail(error.message, "Live Meta draft execution requires a promotedObject for this optimization goal.", 422);
    }
    if (error.message === "META_PIXEL_ID_REQUIRED") {
      return fail(error.message, "Live Meta offsite conversion draft execution requires promotedObject.pixel_id.", 422);
    }
    if (error.message === "META_CONVERSION_EVENT_REQUIRED") {
      return fail(
        error.message,
        "Live Meta offsite conversion draft execution requires a conversion event on promotedObject.",
        422
      );
    }
    if (error.message === "META_PRODUCT_CATALOG_REQUIRED") {
      return fail(error.message, "Live Meta catalog sales drafts require promotedObject.product_catalog_id.", 422);
    }
    if (error.message === "META_APPLICATION_ID_REQUIRED") {
      return fail(error.message, "Live Meta app promotion drafts require promotedObject.application_id.", 422);
    }
    if (error.message === "META_OBJECT_STORE_URL_REQUIRED") {
      return fail(error.message, "Live Meta app promotion drafts require promotedObject.object_store_url.", 422);
    }
    if (error.message === "META_PAGE_ID_REQUIRED") {
      return fail(error.message, "Meta creative creation requires a page id.", 400);
    }
    if (error.message === "META_IMAGE_SOURCE_REQUIRED") {
      return fail(error.message, "Meta image creative creation requires an uploaded image hash or public image URL.", 422);
    }
    if (
      error.message === "META_IMAGE_HASH_MISSING" ||
      error.message === "META_VIDEO_ID_MISSING" ||
      error.message === "META_CREATIVE_ID_MISSING" ||
      error.message === "META_CAMPAIGN_ID_MISSING" ||
      error.message === "META_ADSET_ID_MISSING" ||
      error.message === "META_AD_ID_MISSING"
    ) {
      return fail(error.message, "Meta Graph API response did not include the expected object id.", 502);
    }
    if (error.message === "META_OAUTH_LIVE_NOT_CONFIGURED") {
      return fail(error.message, "Live Meta OAuth is not configured.", 501);
    }
    if (error.message === "TOKEN_ENCRYPTION_KEY_REQUIRED") {
      return fail(error.message, "Token encryption key is required before storing Meta tokens.", 501);
    }
    if (error.message === "TENANT_DATA_DELETION_EXECUTOR_NOT_CONFIGURED") {
      return fail(error.message, "Tenant data deletion executor is not configured for this persistence backend.", 501);
    }
    if (error.message === "PAID_GENERATION_WORKER_NOT_CONFIGURED") {
      return fail(error.message, "Paid generation worker execution is not configured.", 501);
    }
    if (error.message === "APPROVAL_REQUEST_ID_REQUIRED") {
      return fail(error.message, "Approval request id is required.", 400);
    }
    if (error.message === "META_OAUTH_TOKEN_MISSING") {
      return fail(error.message, "Meta OAuth token exchange response did not include a usable token.", 502);
    }
    if (error.message === "META_OAUTH_SCOPES_UNAVAILABLE") {
      return fail(error.message, "Meta OAuth granted scopes could not be resolved server-side.", 502);
    }
    if (error.message === "META_OAUTH_STATE_SECRET_REQUIRED") {
      return fail(error.message, "Meta OAuth state signing secret is required.", 501);
    }
    if (error.message === "PUBLIC_APP_URL_REQUIRED") {
      return fail(error.message, "Public app URL is required for OAuth browser handoff.", 501);
    }
    if (error.message === "META_OAUTH_STATE_REQUIRED") {
      return fail(error.message, "Meta OAuth state is required.", 403);
    }
    if (
      error.message === "META_OAUTH_STATE_INVALID" ||
      error.message === "META_OAUTH_STATE_EXPIRED" ||
      error.message === "META_OAUTH_STATE_TENANT_MISMATCH"
    ) {
      return fail(error.message, "Meta OAuth state verification failed.", 403);
    }
    if (error.message.startsWith("META_OAUTH_CODE_EXCHANGE_FAILED:")) {
      return fail("META_OAUTH_CODE_EXCHANGE_FAILED", "Meta OAuth code exchange failed.", 502, {
        status: error.message.split(":").at(-1)
      });
    }
    if (error.message.startsWith("META_OAUTH_PERMISSIONS_FETCH_FAILED:")) {
      return fail("META_OAUTH_PERMISSIONS_FETCH_FAILED", "Meta OAuth granted scopes lookup failed.", 502, {
        status: error.message.split(":").at(-1)
      });
    }
    if (error.message === "TENANT_REQUIRED") {
      return fail(error.message, "Tenant context is required.", 400);
    }
    if (error.message === "TENANT_MEMBERSHIPS_UNAVAILABLE") {
      return fail(error.message, "Tenant memberships could not be loaded.", 502);
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
