#!/usr/bin/env tsx

import { randomBytes } from "node:crypto";

function base64Key(bytes: number): string {
  return randomBytes(bytes).toString("base64");
}

function urlSafeSecret(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

const entries = [
  ["TOKEN_ENCRYPTION_KEY", base64Key(32)],
  ["TOKEN_ENCRYPTION_KEY_ID", `release-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`],
  ["HERMES_OAUTH_STATE_SECRET", urlSafeSecret(48)],
  ["HERMES_WORKER_SECRET", urlSafeSecret(48)]
] as const;

for (const [key, generated] of entries) {
  console.log(`${key}=${generated}`);
}
