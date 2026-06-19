import { EnvironmentId, ThreadId, TurnId } from "@t3tools/contracts";
import { DraftId } from "./composerDraftStore";
import type { PanelChatTarget } from "./panelLayoutStore";

export type DiffSourceParam = "branch" | "working-tree" | "all-turns" | "last-turn";

const DIFF_SOURCE_VALUES: ReadonlySet<string> = new Set([
  "branch",
  "working-tree",
  "all-turns",
  "last-turn",
]);

export interface DiffRouteSearch {
  diff?: "1" | undefined;
  diffSource?: DiffSourceParam | undefined;
  diffBaseRef?: string | undefined;
  diffTurnId?: TurnId | undefined;
  diffFilePath?: string | undefined;
}

export interface ChatRouteSearch extends DiffRouteSearch {
  sideChats?: string | undefined;
  sideChatActive?: string | undefined;
}

function isDiffOpenValue(value: unknown): boolean {
  return value === "1" || value === 1 || value === true;
}

function normalizeSearchString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function stripDiffSearchParams<T extends Record<string, unknown>>(
  params: T,
): Omit<T, "diff" | "diffSource" | "diffBaseRef" | "diffTurnId" | "diffFilePath"> {
  const {
    diff: _diff,
    diffSource: _diffSource,
    diffBaseRef: _diffBaseRef,
    diffTurnId: _diffTurnId,
    diffFilePath: _diffFilePath,
    ...rest
  } = params;
  return rest as Omit<T, "diff" | "diffSource" | "diffBaseRef" | "diffTurnId" | "diffFilePath">;
}

function encodeSideChatPart(value: string): string {
  return encodeURIComponent(value);
}

function decodeSideChatPart(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

export function serializeSideChatTarget(target: PanelChatTarget): string {
  if (target.kind === "draft") {
    return `d:${encodeSideChatPart(target.draftId)}`;
  }
  return `s:${encodeSideChatPart(target.environmentId)}:${encodeSideChatPart(target.threadId)}`;
}

export function parseSideChatTarget(value: string): PanelChatTarget | null {
  const [kind, first, second, ...rest] = value.split(":");
  if (rest.length > 0) {
    return null;
  }
  if (kind === "d" && first && second === undefined) {
    const draftId = decodeSideChatPart(first);
    return draftId ? { kind: "draft", draftId: DraftId.make(draftId) } : null;
  }
  if (kind === "s" && first && second) {
    const environmentId = decodeSideChatPart(first);
    const threadId = decodeSideChatPart(second);
    return environmentId && threadId
      ? {
          kind: "server",
          environmentId: EnvironmentId.make(environmentId),
          threadId: ThreadId.make(threadId),
        }
      : null;
  }
  return null;
}

export function serializeSideChatTargets(targets: readonly PanelChatTarget[]): string | undefined {
  const serialized = targets.map(serializeSideChatTarget);
  return serialized.length > 0 ? serialized.join(",") : undefined;
}

export function parseSideChatTargets(value: unknown): PanelChatTarget[] {
  const raw = normalizeSearchString(value);
  if (!raw) {
    return [];
  }
  const targets: PanelChatTarget[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const normalizedPart = part.trim();
    if (normalizedPart.length === 0 || seen.has(normalizedPart)) {
      continue;
    }
    const target = parseSideChatTarget(normalizedPart);
    if (!target) {
      continue;
    }
    seen.add(serializeSideChatTarget(target));
    targets.push(target);
  }
  return targets;
}

export function parseDiffRouteSearch(search: Record<string, unknown>): ChatRouteSearch {
  const diff = isDiffOpenValue(search.diff) ? "1" : undefined;
  const diffSourceRaw = diff ? normalizeSearchString(search.diffSource) : undefined;
  const diffSource =
    diffSourceRaw && DIFF_SOURCE_VALUES.has(diffSourceRaw)
      ? (diffSourceRaw as DiffSourceParam)
      : undefined;
  const diffBaseRef =
    diff && diffSource === "branch" ? normalizeSearchString(search.diffBaseRef) : undefined;
  const diffTurnIdRaw = diff ? normalizeSearchString(search.diffTurnId) : undefined;
  const diffTurnId = diffTurnIdRaw ? TurnId.make(diffTurnIdRaw) : undefined;
  const diffFilePath = diff ? normalizeSearchString(search.diffFilePath) : undefined;

  const sideChatTargets = parseSideChatTargets(search.sideChats);
  const sideChats = serializeSideChatTargets(sideChatTargets);
  const activeSideChatRaw = normalizeSearchString(search.sideChatActive);
  const activeSideChatTarget = activeSideChatRaw ? parseSideChatTarget(activeSideChatRaw) : null;
  const activeSideChatSerialized =
    activeSideChatTarget &&
    sideChatTargets.some(
      (target) => serializeSideChatTarget(target) === serializeSideChatTarget(activeSideChatTarget),
    )
      ? serializeSideChatTarget(activeSideChatTarget)
      : undefined;

  return {
    ...(diff ? { diff } : {}),
    ...(diffSource ? { diffSource } : {}),
    ...(diffBaseRef ? { diffBaseRef } : {}),
    ...(diffTurnId ? { diffTurnId } : {}),
    ...(diffFilePath ? { diffFilePath } : {}),
    ...(sideChats ? { sideChats } : {}),
    ...(activeSideChatSerialized ? { sideChatActive: activeSideChatSerialized } : {}),
  };
}
