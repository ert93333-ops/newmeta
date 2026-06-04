#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const SUPABASE_CLI_VERSION = process.env.SUPABASE_CLI_VERSION ?? "2.104.0";
const NPX = "npx";
const DOCKER = "docker";

const supabaseArgs = ["--yes", `supabase@${SUPABASE_CLI_VERSION}`];

function redact(text) {
  return text
    .replace(/sb_secret_[A-Za-z0-9_-]+/g, "sb_secret_[REDACTED]")
    .replace(/sb_publishable_[A-Za-z0-9_-]+/g, "sb_publishable_[REDACTED]")
    .replace(/(postgresql:\/\/[^:\s]+:)[^@\s]+(@)/g, "$1[REDACTED]$2")
    .replace(/(Access Key\s+)[A-Za-z0-9_-]+/gi, "$1[REDACTED]")
    .replace(/(Secret Key\s+)[A-Za-z0-9_-]+/gi, "$1[REDACTED]")
    .replace(/(Secret\s+)[A-Za-z0-9_-]+/gi, "$1[REDACTED]")
    .replace(/(Authorization:\s*Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[REDACTED]");
}

function printOutput(stdout, stderr) {
  const output = [stdout, stderr].filter(Boolean).join("\n").trim();
  if (output) {
    console.log(redact(output));
  }
}

function quoteWindowsArg(arg) {
  return `"${arg.replace(/"/g, '\\"')}"`;
}

function run(label, command, args, options = {}) {
  const { quietOnSuccess = false } = options;
  console.log(`[supabase-validate] ${label}`);

  const spawnOptions = {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      NO_COLOR: "1"
    }
  };

  const result =
    process.platform === "win32"
      ? spawnSync([command, ...args.map(quoteWindowsArg)].join(" "), { ...spawnOptions, shell: true })
      : spawnSync(command, args, spawnOptions);

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    printOutput(result.stdout, result.stderr);
    throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}`);
  }

  if (!quietOnSuccess) {
    printOutput(result.stdout, result.stderr);
  }
}

function supabase(label, args, options) {
  run(label, NPX, [...supabaseArgs, ...args], options);
}

try {
  run("check Docker engine", DOCKER, ["info", "--format", "{{.ServerVersion}}"], { quietOnSuccess: true });
  supabase("start local Supabase database", ["db", "start"], { quietOnSuccess: true });
  supabase("reset local database with migrations", ["db", "reset", "--local", "--no-seed"]);
  supabase("lint local database schemas", ["db", "lint", "--local", "--fail-on", "warning"]);
  supabase("run local security advisors", [
    "db",
    "advisors",
    "--local",
    "--type",
    "security",
    "--level",
    "warn",
    "--fail-on",
    "warn"
  ]);
  supabase("run local performance advisors", [
    "db",
    "advisors",
    "--local",
    "--type",
    "performance",
    "--level",
    "warn",
    "--fail-on",
    "error"
  ]);
  console.log("[supabase-validate] complete");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[supabase-validate] ${redact(message)}`);
  process.exit(1);
}
