#!/usr/bin/env tsx

import { checkReleaseEnv } from "../src/lib/ops/release-env";

function redact(text: string): string {
  return text
    .replace(/sb_secret_[A-Za-z0-9_-]+/g, "sb_secret_[REDACTED]")
    .replace(/sb_publishable_[A-Za-z0-9_-]+/g, "sb_publishable_[REDACTED]")
    .replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+(@)/g, "$1[REDACTED]$2")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[REDACTED]");
}

const result = checkReleaseEnv(process.env);

if (!result.passed) {
  console.error("[env-release-gates] BLOCKED");
  for (const issue of result.issues) {
    console.error(`[env-release-gates] ${issue.code}: ${redact(issue.message)}`);
  }
  process.exit(1);
}

console.log("[env-release-gates] passed");
