#!/usr/bin/env node

import { execFileSync } from "node:child_process";

function runGit(args, options = {}) {
  const { allowFail = false, stdio = "pipe" } = options;
  try {
    const execOptions = { encoding: "utf8" };
    if (stdio === "inherit") {
      execOptions.stdio = "inherit";
    }
    const output = execFileSync("git", args, execOptions);
    if (output === null) return "";
    return output.trim();
  } catch (error) {
    if (allowFail) return null;
    throw error;
  }
}

function ensureGitRepo() {
  const top = runGit(["rev-parse", "--show-toplevel"], { allowFail: true });
  if (!top) {
    throw new Error("Not inside a git repository.");
  }
  return top;
}

function hasRemote(name) {
  const value = runGit(["remote", "get-url", name], { allowFail: true });
  return Boolean(value);
}

function getUpstreamRef() {
  const symbolic = runGit(["symbolic-ref", "refs/remotes/upstream/HEAD"], { allowFail: true });
  if (symbolic) {
    return symbolic.replace(/^refs\/remotes\//, "");
  }
  const fallback = runGit(["show-ref", "--verify", "refs/remotes/upstream/main"], {
    allowFail: true,
  });
  if (fallback) return "upstream/main";
  throw new Error("Could not resolve upstream default branch. Ensure remote 'upstream' exists.");
}

function getCurrentBranch() {
  return runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
}

function requireCleanWorktree() {
  const dirty = runGit(["status", "--porcelain"]);
  if (dirty.length > 0) {
    throw new Error(
      "Worktree is not clean. Commit/stash your changes before running sync commands.",
    );
  }
}

function getAheadBehind(leftRef, rightRef) {
  const counts = runGit(["rev-list", "--left-right", "--count", `${leftRef}...${rightRef}`]);
  const [left, right] = counts.split(/\s+/).map((value) => Number.parseInt(value, 10));
  return {
    leftOnly: Number.isFinite(left) ? left : 0,
    rightOnly: Number.isFinite(right) ? right : 0,
  };
}

function printStatus(upstreamRef, currentBranch) {
  const currentVsUpstream = getAheadBehind(upstreamRef, currentBranch);

  console.log(`upstream default: ${upstreamRef}`);
  console.log(`current branch:   ${currentBranch}`);
  console.log(
    `current vs upstream: behind=${currentVsUpstream.leftOnly} ahead=${currentVsUpstream.rightOnly}`,
  );

  const upstreamBranchName = upstreamRef.split("/")[1] ?? "main";
  const localMainRef = runGit(["show-ref", "--verify", `refs/heads/${upstreamBranchName}`], {
    allowFail: true,
  })
    ? upstreamBranchName
    : null;

  if (localMainRef) {
    const localMainVsUpstream = getAheadBehind(upstreamRef, localMainRef);
    console.log(
      `${localMainRef} vs upstream: behind=${localMainVsUpstream.leftOnly} ahead=${localMainVsUpstream.rightOnly}`,
    );
  } else {
    console.log(`local '${upstreamBranchName}' branch not found`);
  }

  if (hasRemote("origin")) {
    const originMainRef = `origin/${upstreamBranchName}`;
    const hasOriginMain = runGit(["show-ref", "--verify", `refs/remotes/${originMainRef}`], {
      allowFail: true,
    });
    if (hasOriginMain) {
      const originMainVsUpstream = getAheadBehind(upstreamRef, originMainRef);
      console.log(
        `${originMainRef} vs upstream: behind=${originMainVsUpstream.leftOnly} ahead=${originMainVsUpstream.rightOnly}`,
      );
    } else {
      console.log(`remote branch '${originMainRef}' not found`);
    }
  }
}

function ensureLocalMainBranch(upstreamRef) {
  const branchName = upstreamRef.split("/")[1] ?? "main";
  const exists = runGit(["show-ref", "--verify", `refs/heads/${branchName}`], {
    allowFail: true,
  });
  if (exists) return branchName;

  runGit(["switch", "-c", branchName, "--track", upstreamRef], { stdio: "inherit" });
  return branchName;
}

function syncMain(upstreamRef, pushOrigin) {
  requireCleanWorktree();

  const startingBranch = getCurrentBranch();
  const mainBranch = ensureLocalMainBranch(upstreamRef);

  if (getCurrentBranch() !== mainBranch) {
    runGit(["switch", mainBranch], { stdio: "inherit" });
  }

  runGit(["rebase", upstreamRef], { stdio: "inherit" });

  if (pushOrigin) {
    if (!hasRemote("origin")) {
      throw new Error("Cannot push: remote 'origin' not found.");
    }
    runGit(["push", "--force-with-lease", "origin", mainBranch], { stdio: "inherit" });
  }

  if (startingBranch !== mainBranch) {
    runGit(["switch", startingBranch], { stdio: "inherit" });
  }
}

function rebaseCurrent(upstreamRef) {
  requireCleanWorktree();
  runGit(["rebase", upstreamRef], { stdio: "inherit" });
}

function usage() {
  console.log("Usage: node scripts/sync-upstream-fork.mjs <command> [flags]");
  console.log("");
  console.log("Commands:");
  console.log("  status            Fetch and print ahead/behind against upstream");
  console.log("  sync-main         Rebase local main onto upstream default branch");
  console.log("  rebase-current    Rebase current branch onto upstream default branch");
  console.log("");
  console.log("Flags:");
  console.log("  --push-origin     With sync-main, force-with-lease push main to origin");
}

function main() {
  ensureGitRepo();

  if (!hasRemote("upstream")) {
    throw new Error(
      "Remote 'upstream' is missing. Add it with: git remote add upstream https://github.com/pingdotgg/t3code.git",
    );
  }

  const command = process.argv[2] ?? "status";
  const pushOrigin = process.argv.includes("--push-origin");

  try {
    runGit(["fetch", "--prune", "upstream"], { stdio: "inherit" });
  } catch (error) {
    if (command !== "status") {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`warning: fetch upstream failed, using local refs (${message})`);
  }

  const upstreamRef = getUpstreamRef();
  const currentBranch = getCurrentBranch();

  if (command === "status") {
    printStatus(upstreamRef, currentBranch);
    return;
  }

  if (command === "sync-main") {
    syncMain(upstreamRef, pushOrigin);
    printStatus(upstreamRef, getCurrentBranch());
    return;
  }

  if (command === "rebase-current") {
    rebaseCurrent(upstreamRef);
    printStatus(upstreamRef, getCurrentBranch());
    return;
  }

  usage();
  process.exitCode = 1;
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`sync-upstream error: ${message}`);
  process.exit(1);
}
