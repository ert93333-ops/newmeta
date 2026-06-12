#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";

const REQUIRED_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_META_SMOKE_EMAIL",
  "SUPABASE_META_SMOKE_PASSWORD",
  "SUPABASE_META_SMOKE_TENANT_ID"
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

function assertNoCredentialEcho(body, label) {
  const serialized = JSON.stringify(body);
  if (/\b(access_token|refresh_token|client_secret|token_iv|token_auth_tag|encrypted_access_token|authorization)\b/i.test(serialized)) {
    throw new Error(`${label} echoed credential-shaped fields`);
  }
}

async function main() {
  const missing = missingEnvKeys();
  if (missing.length > 0) {
    console.error(`[meta-smoke] BLOCKED missing env: ${missing.join(", ")}`);
    console.error(
      "[meta-smoke] Required: deployed app URL, Supabase URL/publishable key, smoke user credentials, and a tenant with a stored live Meta OAuth connection."
    );
    process.exit(1);
  }

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
    email: requiredValue("SUPABASE_META_SMOKE_EMAIL"),
    password: requiredValue("SUPABASE_META_SMOKE_PASSWORD")
  });

  if (error || !data.session?.access_token) {
    throw new Error(`Supabase Meta smoke sign-in failed: ${redact(error?.message ?? "missing session")}`);
  }

  const baseUrl = normalizeAppUrl(appUrl());
  const response = await globalThis.fetch(`${baseUrl}/api/meta/ad-accounts`, {
    headers: {
      authorization: `Bearer ${data.session.access_token}`,
      "x-tenant-id": requiredValue("SUPABASE_META_SMOKE_TENANT_ID")
    }
  });
  const body = await readJson(response);

  if (response.status !== 200) {
    throw new Error(`Meta ad accounts smoke expected 200, got ${response.status}: ${redact(JSON.stringify(body))}`);
  }
  assertNoCredentialEcho(body, "Meta ad accounts smoke");

  if (body?.adapterMode !== "live") {
    throw new Error(`Meta ad accounts smoke did not use live adapter: ${redact(JSON.stringify({ adapterMode: body?.adapterMode }))}`);
  }
  if (!Array.isArray(body?.adAccounts)) {
    throw new Error("Meta ad accounts smoke did not return an adAccounts array");
  }

  console.log(`[meta-smoke] passed live ad account read, count=${body.adAccounts.length}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[meta-smoke] failed: ${redact(message)}`);
  process.exit(1);
});
