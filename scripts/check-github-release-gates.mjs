#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const DEFAULT_BRANCH = process.env.GITHUB_RELEASE_BRANCH ?? "main";
const WORKFLOW_NAME = process.env.GITHUB_RELEASE_WORKFLOW ?? "CI";

function redact(text) {
  return String(text)
    .replace(/gh[opsu]_[A-Za-z0-9_]+/g, "gh[REDACTED]")
    .replace(/(Authorization:\s*Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[REDACTED]");
}

function quoteWindowsArg(arg) {
  return `"${String(arg).replace(/"/g, '\\"')}"`;
}

function run(command, args, options = {}) {
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

  if (options.allowFailure) {
    return result;
  }

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${command} ${args.join(" ")} failed: ${redact(output)}`);
  }

  return result.stdout.trim();
}

function parseJson(output, label) {
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error(`${label} did not return valid JSON: ${redact(output)}`);
  }
}

function assertCleanGitStatus() {
  const status = run("git", ["status", "--porcelain=v1"]);
  if (status) {
    throw new Error("working tree must be clean before release.");
  }
  console.log("[github-release-gates] working tree clean");
}

function getRepository() {
  const remote = run("git", ["config", "--get", "remote.origin.url"]);
  const match = remote.match(/github\.com[:/](?<owner>[^/]+)\/(?<repo>[^/.]+)(?:\.git)?$/i);
  if (!match?.groups) {
    throw new Error(`origin remote must be a GitHub repository, got: ${remote}`);
  }

  const repository = `${match.groups.owner}/${match.groups.repo}`;
  console.log(`[github-release-gates] repository ${repository}`);
  return repository;
}

function assertBranchAndRemote(branch) {
  const currentBranch = run("git", ["branch", "--show-current"]);
  if (currentBranch !== branch) {
    throw new Error(`release branch must be ${branch}, got ${currentBranch || "(detached)"}.`);
  }

  run("git", ["fetch", "origin", branch]);
  const localHead = run("git", ["rev-parse", "HEAD"]);
  const remoteHead = run("git", ["rev-parse", `origin/${branch}`]);

  if (localHead !== remoteHead) {
    throw new Error(`${branch} must be pushed to origin/${branch} before release.`);
  }

  console.log(`[github-release-gates] ${branch} is synced with origin/${branch}`);
  return localHead;
}

function assertLatestWorkflowSuccess(branch, headSha) {
  const output = run("gh", [
    "run",
    "list",
    "--workflow",
    WORKFLOW_NAME,
    "--branch",
    branch,
    "--limit",
    "1",
    "--json",
    "databaseId,headSha,status,conclusion,url,workflowName"
  ]);

  const runs = parseJson(output, "gh run list");
  const runInfo = runs[0];
  if (!runInfo) {
    throw new Error(`no ${WORKFLOW_NAME} workflow run found for ${branch}.`);
  }

  if (runInfo.headSha !== headSha) {
    throw new Error(
      `latest ${WORKFLOW_NAME} run is not for HEAD. Expected ${headSha}, got ${runInfo.headSha}: ${runInfo.url}`
    );
  }

  if (runInfo.status !== "completed" || runInfo.conclusion !== "success") {
    throw new Error(
      `${WORKFLOW_NAME} must complete successfully before release. Current: ${runInfo.status}/${runInfo.conclusion || "none"} ${runInfo.url}`
    );
  }

  console.log(`[github-release-gates] ${WORKFLOW_NAME} succeeded for HEAD: ${runInfo.url}`);
}

function assertBranchProtection(repository, branch) {
  const result = run("gh", ["api", `repos/${repository}/branches/${branch}/protection`], { allowFailure: true });
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();

  if (result.status !== 0) {
    if (result.status === 1 && /Upgrade to GitHub Pro|make this repository public/i.test(output)) {
      throw new Error(
        "branch protection is blocked by the current GitHub plan for this private repository. Upgrade GitHub plan or make the repository public, then require CI before release."
      );
    }

    throw new Error(`branch protection must be configured before release: ${redact(output)}`);
  }

  const protection = parseJson(output, "branch protection");
  if (!protection.required_status_checks) {
    throw new Error("branch protection must require status checks before release.");
  }

  const checks = protection.required_status_checks.contexts ?? [];
  if (!checks.some((check) => String(check).toLowerCase().includes("ci"))) {
    throw new Error(`branch protection must require the CI status check. Current checks: ${checks.join(", ") || "none"}`);
  }

  if (protection.allow_force_pushes?.enabled) {
    throw new Error("branch protection must not allow force pushes.");
  }

  if (protection.allow_deletions?.enabled) {
    throw new Error("branch protection must not allow branch deletion.");
  }

  console.log("[github-release-gates] branch protection configured");
}

try {
  assertCleanGitStatus();
  const repository = getRepository();
  const headSha = assertBranchAndRemote(DEFAULT_BRANCH);
  assertLatestWorkflowSuccess(DEFAULT_BRANCH, headSha);
  assertBranchProtection(repository, DEFAULT_BRANCH);
  console.log("[github-release-gates] passed");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[github-release-gates] BLOCKED ${redact(message)}`);
  process.exit(1);
}
