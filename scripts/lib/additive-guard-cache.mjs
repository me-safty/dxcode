import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const CACHE_FILE = path.join(".git", "hooks", "t3work-additive-guard-cache.json");

export function loadAdditiveGuardCache(cwd) {
  const cachePath = path.join(cwd, CACHE_FILE);
  if (!existsSync(cachePath)) {
    return { cachePath, entries: {} };
  }

  try {
    const parsed = JSON.parse(readFileSync(cachePath, "utf8"));
    return { cachePath, entries: parsed.entries ?? {} };
  } catch {
    return { cachePath, entries: {} };
  }
}

export function saveAdditiveGuardCache(cachePath, entries) {
  const parentDir = path.dirname(cachePath);
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  writeFileSync(cachePath, `${JSON.stringify({ entries }, null, 2)}\n`, "utf8");
}

export function fileFingerprint(filePath) {
  const stats = statSync(filePath);
  return `${stats.size}:${Math.floor(stats.mtimeMs)}`;
}

export function additiveGuardCacheKey({
  kind,
  baseCommit,
  mergeBase,
  filePath,
  fingerprint,
  configKey,
}) {
  return [kind, baseCommit, mergeBase, filePath, fingerprint, configKey].join("\0");
}

export function additiveGuardConfigCacheKey(config) {
  return JSON.stringify({
    requiredPrefixes: config.requiredPrefixes,
    locWarnThreshold: config.locWarnThreshold,
    locFailThreshold: config.locFailThreshold,
    allowedModifiedFiles: config.allowedModifiedFiles,
    allowedModifiedFileGlobs: config.allowedModifiedFileGlobs,
    allowedUnprefixedNewFiles: config.allowedUnprefixedNewFiles,
  });
}
