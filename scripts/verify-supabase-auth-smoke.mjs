#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";

const REQUIRED_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_AUTH_SMOKE_EMAIL",
  "SUPABASE_AUTH_SMOKE_PASSWORD",
  "SUPABASE_AUTH_SMOKE_TENANT_ID"
];

function redact(text) {
  return String(text)
    .replace(/sb_secret_[A-Za-z0-9_-]+/g, "sb_secret_[REDACTED]")
    .replace(/sb_publishable_[A-Za-z0-9_-]+/g, "sb_publishable_[REDACTED]")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[REDACTED]")
    .replace(/(password=)[^&\s]+/gi, "$1[REDACTED]");
}

function requiredValue(key) {
  const value = process.env[key]?.trim();
  return value || undefined;
}

function appUrl() {
  return requiredValue("HERMES_APP_URL") ?? requiredValue("NEXT_PUBLIC_APP_URL");
}

function missingEnvKeys() {
  const missing = REQUIRED_ENV.filter((key) => !requiredValue(key));
  if (!appUrl()) {
    missing.push("HERMES_APP_URL or NEXT_PUBLIC_APP_URL");
  }
  return missing;
}

function normalizeAppUrl(value) {
  try {
    return new URL(value).origin;
  } catch {
    throw new Error("HERMES_APP_URL/NEXT_PUBLIC_APP_URL must be an absolute URL.");
  }
}

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

async function callJson(baseUrl, path, { accessToken, tenantId, method = "GET", body } = {}) {
  const headers = {};
  if (accessToken) {
    headers.authorization = `Bearer ${accessToken}`;
  }
  if (tenantId) {
    headers["x-tenant-id"] = tenantId;
  }
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }

  const response = await globalThis.fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return {
    status: response.status,
    body: await readJson(response)
  };
}

async function callMe(baseUrl, accessToken, tenantId) {
  return callJson(baseUrl, "/api/me", { accessToken, tenantId });
}

async function callMetaConnectUrl(baseUrl, accessToken, tenantId) {
  return callJson(baseUrl, "/api/integrations/meta/connect-url", { accessToken, tenantId });
}

async function callBudgetBoundary(baseUrl, accessToken, tenantId) {
  return callJson(baseUrl, "/api/settings/budget", {
    accessToken,
    tenantId,
    method: "PATCH",
    body: {
      note: "Smoke test should still hit the hard block on the budget namespace."
    }
  });
}

function assertStatus(result, expectedStatus, label) {
  if (result.status !== expectedStatus) {
    throw new Error(`${label} expected ${expectedStatus}, got ${result.status}: ${redact(JSON.stringify(result.body))}`);
  }
}

function assertNoCredentialEcho(body, label) {
  const serialized = JSON.stringify(body);
  if (/\b(access_token|refresh_token|client_secret|token_iv|token_auth_tag|encrypted_access_token)\b/i.test(serialized)) {
    throw new Error(`${label} echoed credential-shaped fields`);
  }
}

async function main() {
  const missing = missingEnvKeys();
  if (missing.length > 0) {
    console.error(`[auth-smoke] BLOCKED missing env: ${missing.join(", ")}`);
    console.error(
      "[auth-smoke] Required: deployed app URL, Supabase URL/publishable key, smoke user email/password, allowed tenant id."
    );
    process.exit(1);
  }

  const baseUrl = normalizeAppUrl(appUrl());
  const tenantId = requiredValue("SUPABASE_AUTH_SMOKE_TENANT_ID");
  const deniedTenantId = requiredValue("SUPABASE_AUTH_SMOKE_DENIED_TENANT_ID");

  const unauthenticated = await callMe(baseUrl);
  assertStatus(unauthenticated, 401, "unauthenticated /api/me");

  const unauthenticatedConnectUrl = await callMetaConnectUrl(baseUrl, undefined, tenantId);
  assertStatus(unauthenticatedConnectUrl, 401, "unauthenticated Meta connect URL");

  const supabase = createClient(
    requiredValue("NEXT_PUBLIC_SUPABASE_URL"),
    requiredValue("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    }
  );

  const { data, error } = await supabase.auth.signInWithPassword({
    email: requiredValue("SUPABASE_AUTH_SMOKE_EMAIL"),
    password: requiredValue("SUPABASE_AUTH_SMOKE_PASSWORD")
  });

  if (error || !data.session?.access_token) {
    throw new Error(`Supabase smoke sign-in failed: ${redact(error?.message ?? "missing session")}`);
  }

  const bootstrap = await callMe(baseUrl, data.session.access_token);
  assertStatus(bootstrap, 200, "membership bootstrap /api/me");
  if (!Array.isArray(bootstrap.body?.memberships)) {
    throw new Error("membership bootstrap /api/me did not return memberships");
  }
  if (!bootstrap.body.memberships.some((membership) => membership?.tenantId === tenantId)) {
    throw new Error("membership bootstrap /api/me did not include the allowed tenant");
  }
  if (!bootstrap.body?.activeTenant) {
    throw new Error("membership bootstrap /api/me did not return an active tenant");
  }
  assertNoCredentialEcho(bootstrap.body, "membership bootstrap /api/me");

  const allowed = await callMe(baseUrl, data.session.access_token, tenantId);
  assertStatus(allowed, 200, "allowed tenant /api/me");

  if (allowed.body?.user?.tenantId !== tenantId) {
    throw new Error("allowed tenant /api/me returned the wrong tenant id");
  }
  if (allowed.body?.permissions?.budgetMutation !== "hard_blocked") {
    throw new Error("allowed tenant /api/me did not report budget mutation as hard_blocked");
  }
  assertNoCredentialEcho(allowed.body, "allowed tenant /api/me");

  const budgetBoundary = await callBudgetBoundary(baseUrl, data.session.access_token, tenantId);
  assertStatus(budgetBoundary, 403, "allowed tenant budget settings boundary");
  if (budgetBoundary.body?.error?.code !== "BUDGET_MUTATION_HARD_BLOCKED") {
    throw new Error("allowed tenant budget settings boundary did not return BUDGET_MUTATION_HARD_BLOCKED");
  }

  const connectUrl = await callMetaConnectUrl(baseUrl, data.session.access_token, tenantId);
  assertStatus(connectUrl, 200, "allowed tenant Meta connect URL");
  if (!String(connectUrl.body?.connectUrl ?? "").startsWith("https://www.facebook.com/dialog/oauth")) {
    throw new Error("allowed tenant Meta connect URL did not return a Meta OAuth URL");
  }
  if (connectUrl.body?.stateBound !== true || typeof connectUrl.body?.stateExpiresAt !== "string") {
    throw new Error("allowed tenant Meta connect URL did not return signed state metadata");
  }
  assertNoCredentialEcho(connectUrl.body, "allowed tenant Meta connect URL");

  if (deniedTenantId) {
    const denied = await callMe(baseUrl, data.session.access_token, deniedTenantId);
    assertStatus(denied, 403, "denied tenant /api/me");
    if (denied.body?.error?.code !== "TENANT_ACCESS_DENIED") {
      throw new Error("denied tenant /api/me did not return TENANT_ACCESS_DENIED");
    }

    const deniedConnectUrl = await callMetaConnectUrl(baseUrl, data.session.access_token, deniedTenantId);
    assertStatus(deniedConnectUrl, 403, "denied tenant Meta connect URL");
    if (deniedConnectUrl.body?.error?.code !== "TENANT_ACCESS_DENIED") {
      throw new Error("denied tenant Meta connect URL did not return TENANT_ACCESS_DENIED");
    }
  }

  console.log("[auth-smoke] passed");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[auth-smoke] failed: ${redact(message)}`);
  process.exit(1);
});
