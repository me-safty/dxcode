import type { WorkLogEntry } from "../session-logic";
import { formatDuration } from "../session-logic";
import { formatWorkspaceRelativePath } from "../filePathDisplay";
import { createChangedFileDiffPathMatcher } from "./diffRendering";

export const COMMAND_OUTPUT_TAIL_LINES = 40;

export function hasRenderableCommandOutput(value: string | null | undefined): value is string {
  return getRenderableCommandOutputLines(value).length > 0;
}

export function getRenderableCommandOutputLines(value: string | null | undefined): string[] {
  if (typeof value !== "string" || value.length === 0) {
    return [];
  }
  const lines = value.split(/\r?\n/u);
  let startIndex = 0;
  let endIndex = lines.length;
  while (startIndex < endIndex && (lines[startIndex]?.trim().length ?? 0) === 0) {
    startIndex += 1;
  }
  while (endIndex > startIndex && (lines[endIndex - 1]?.trim().length ?? 0) === 0) {
    endIndex -= 1;
  }
  return lines.slice(startIndex, endIndex);
}

export function buildSupplementalToolDetailBody(
  workEntry: WorkLogEntry,
  options: { dedupeRenderedCommandOutput: boolean },
): string | null {
  const detail = workEntry.detail?.trim();
  if (!detail) {
    return null;
  }
  const command = workEntry.command?.trim();
  const rawCommand = workEntry.rawCommand?.trim();
  const renderedOutputMatchesDetail =
    options.dedupeRenderedCommandOutput && commandOutputMatchesDetail(workEntry, detail);
  if (detail === command || detail === rawCommand || renderedOutputMatchesDetail) {
    return null;
  }
  return detail;
}

function commandOutputMatchesDetail(workEntry: WorkLogEntry, detail: string): boolean {
  const stdoutLines = getRenderableCommandOutputLines(workEntry.stdout);
  const stderrLines = getRenderableCommandOutputLines(workEntry.stderr);
  const hasStreamOutput = stdoutLines.length > 0 || stderrLines.length > 0;
  const outputLines = hasStreamOutput ? [] : getRenderableCommandOutputLines(workEntry.output);
  const normalizedDetail = normalizeToolDetailLines(detail.split(/\r?\n/u));

  return [stdoutLines, stderrLines, outputLines].some(
    (lines) => lines.length > 0 && normalizeToolDetailLines(lines) === normalizedDetail,
  );
}

function normalizeToolDetailLines(lines: ReadonlyArray<string>): string {
  const normalizedLines = lines.map((line) => line.trim());
  let startIndex = 0;
  let endIndex = normalizedLines.length;
  while (startIndex < endIndex && normalizedLines[startIndex]?.length === 0) {
    startIndex += 1;
  }
  while (endIndex > startIndex && normalizedLines[endIndex - 1]?.length === 0) {
    endIndex -= 1;
  }
  return normalizedLines.slice(startIndex, endIndex).join("\n");
}

function isCollabAgentWorkEntry(workEntry: WorkLogEntry): boolean {
  // Collab-agent rows own their nested activity UI; do not re-expand them as
  // command or file-change detail boxes.
  return workEntry.itemType === "collab_agent_tool_call";
}

export function hasCommandWorkEntryDetails(workEntry: WorkLogEntry): boolean {
  if (!hasCommandWorkEntryMetadata(workEntry)) {
    return false;
  }
  if (isCollabAgentWorkEntry(workEntry)) {
    return false;
  }
  if (workEntry.itemType === "command_execution" || workEntry.requestKind === "command") {
    return true;
  }
  if (workEntry.itemType === "file_change" || workEntry.requestKind === "file-change") {
    return false;
  }
  if (workEntry.itemType) {
    return workEntry.itemType === "dynamic_tool_call";
  }
  return Boolean(workEntry.command || workEntry.rawCommand);
}

function hasCommandWorkEntryMetadata(workEntry: WorkLogEntry): boolean {
  return Boolean(
    workEntry.command ||
    workEntry.rawCommand ||
    workEntry.output ||
    workEntry.stdout ||
    workEntry.stderr ||
    workEntry.exitCode != null ||
    workEntry.durationMs != null,
  );
}

export interface DerivedCommandOutputSection {
  title: "Stdout" | "Stderr" | "Output";
  value: string;
  tone?: "default" | "error";
}

export interface DerivedCommandWorkEntryDetails {
  command: string | null;
  rawCommand: string | null;
  exitCodeLabel: string;
  durationLabel: string;
  outputs: ReadonlyArray<DerivedCommandOutputSection>;
}

export interface DerivedFileChangeWorkEntryDetails {
  id: string;
  patch: string | undefined;
  changedFiles: ReadonlyArray<string>;
}

export interface DerivedExpandableWorkEntryDetails {
  command: DerivedCommandWorkEntryDetails | null;
  fileChange: DerivedFileChangeWorkEntryDetails | null;
  supplementalDetail: string | null;
  genericDetail: string | null;
}

function deriveRawCommand(workEntry: Pick<WorkLogEntry, "command" | "rawCommand">): string | null {
  const rawCommand = workEntry.rawCommand?.trim();
  if (!rawCommand || !workEntry.command) {
    return null;
  }
  return rawCommand === workEntry.command.trim() ? null : rawCommand;
}

function buildGenericToolExpandedBody(
  workEntry: WorkLogEntry,
  workspaceRoot: string | undefined,
): string | null {
  const blocks: string[] = [];
  if (workEntry.itemType === "mcp_tool_call" && workEntry.toolData !== undefined) {
    blocks.push(`MCP call\n${JSON.stringify(workEntry.toolData, null, 2)}`);
  }
  const raw = deriveRawCommand(workEntry);
  if (raw?.trim()) {
    blocks.push(raw.trim());
  } else if (workEntry.command?.trim()) {
    blocks.push(workEntry.command.trim());
  }
  if (workEntry.detail?.trim()) {
    blocks.push(workEntry.detail.trim());
  }
  const changedFiles = workEntry.changedFiles ?? [];
  if (changedFiles.length > 0) {
    blocks.push(
      changedFiles
        .map((filePath) => formatWorkspaceRelativePath(filePath, workspaceRoot))
        .join("\n"),
    );
  }
  return blocks.length > 0 ? blocks.join("\n\n") : null;
}

function hasGenericToolExpandedBody(workEntry: WorkLogEntry): boolean {
  if (workEntry.itemType === "mcp_tool_call" && workEntry.toolData !== undefined) {
    return true;
  }
  const raw = deriveRawCommand(workEntry);
  return Boolean(
    raw?.trim() ||
    workEntry.command?.trim() ||
    workEntry.detail?.trim() ||
    (workEntry.changedFiles?.length ?? 0) > 0,
  );
}

export function hasExpandableWorkEntryDetails(workEntry: WorkLogEntry): boolean {
  return (
    hasCommandWorkEntryDetails(workEntry) ||
    hasFileChangeWorkEntryDetails(workEntry) ||
    hasGenericToolExpandedBody(workEntry)
  );
}

function deriveCommandWorkEntryDetails(workEntry: WorkLogEntry): DerivedCommandWorkEntryDetails {
  const command = workEntry.command ?? workEntry.rawCommand ?? null;
  const rawCommand =
    workEntry.rawCommand && workEntry.rawCommand !== command ? workEntry.rawCommand : null;
  const stdout = hasRenderableCommandOutput(workEntry.stdout) ? workEntry.stdout : null;
  const stderr = hasRenderableCommandOutput(workEntry.stderr) ? workEntry.stderr : null;
  const output =
    !stdout && !stderr && hasRenderableCommandOutput(workEntry.output) ? workEntry.output : null;
  const outputs: DerivedCommandOutputSection[] = [];
  if (stdout) {
    outputs.push({ title: "Stdout", value: stdout });
  }
  if (stderr) {
    outputs.push({ title: "Stderr", value: stderr, tone: "error" });
  }
  if (output) {
    outputs.push({ title: "Output", value: output });
  }

  return {
    command,
    rawCommand,
    exitCodeLabel: String(workEntry.exitCode ?? "unknown"),
    durationLabel:
      workEntry.durationMs !== undefined ? formatDuration(workEntry.durationMs) : "unknown",
    outputs,
  };
}

export function deriveExpandableWorkEntryDetails(
  workEntry: WorkLogEntry,
  workspaceRoot: string | undefined,
): DerivedExpandableWorkEntryDetails | null {
  const showCommandDetails = hasCommandWorkEntryDetails(workEntry);
  const showFileChangeDetails = hasFileChangeWorkEntryDetails(workEntry);
  const supplementalDetail =
    showCommandDetails || showFileChangeDetails
      ? buildSupplementalToolDetailBody(workEntry, {
          dedupeRenderedCommandOutput: showCommandDetails,
        })
      : null;

  if (showCommandDetails || showFileChangeDetails) {
    return {
      command: showCommandDetails ? deriveCommandWorkEntryDetails(workEntry) : null,
      fileChange: showFileChangeDetails
        ? {
            id: workEntry.id,
            patch: workEntry.patch,
            changedFiles: workEntry.changedFiles ?? [],
          }
        : null,
      supplementalDetail,
      genericDetail: null,
    };
  }

  const genericDetail = buildGenericToolExpandedBody(workEntry, workspaceRoot);
  return genericDetail
    ? {
        command: null,
        fileChange: null,
        supplementalDetail: null,
        genericDetail,
      }
    : null;
}

export function hasFileChangeWorkEntryDetails(workEntry: WorkLogEntry): boolean {
  if (isCollabAgentWorkEntry(workEntry)) {
    return false;
  }
  return Boolean(workEntry.patch || (workEntry.changedFiles?.length ?? 0) > 0);
}

export function filterChangedFilesWithoutInlineDiff(
  changedFiles: ReadonlyArray<string> | undefined,
  inlineDiffPaths: ReadonlyArray<string>,
): string[] {
  if (!changedFiles || changedFiles.length === 0) {
    return [];
  }
  if (inlineDiffPaths.length === 0) {
    return [...changedFiles];
  }
  const inlineDiffMatchers = inlineDiffPaths.map(createChangedFileDiffPathMatcher);
  return changedFiles.filter(
    (changedFile) => !inlineDiffMatchers.some((matchesDiffPath) => matchesDiffPath(changedFile)),
  );
}

export interface DerivedFileChangeDisplayFile {
  path: string;
  displayPath: string;
}

export function deriveFileChangeDisplayFiles(input: {
  changedFiles: ReadonlyArray<string> | undefined;
  inlineDiffPaths: ReadonlyArray<string>;
  workspaceRoot: string | undefined;
}): DerivedFileChangeDisplayFile[] {
  return filterChangedFilesWithoutInlineDiff(input.changedFiles, input.inlineDiffPaths).map(
    (filePath) => ({
      path: filePath,
      displayPath: formatWorkspaceRelativePath(filePath, input.workspaceRoot),
    }),
  );
}

export interface DerivedCommandOutputDisplay {
  isTruncated: boolean;
  visibleValue: string;
  suffix: string;
}

export function deriveCommandOutputDisplay(input: {
  value: string;
  showFull: boolean;
  maxVisibleLines?: number;
}): DerivedCommandOutputDisplay {
  const maxVisibleLines = input.maxVisibleLines ?? COMMAND_OUTPUT_TAIL_LINES;
  const lines = getRenderableCommandOutputLines(input.value);
  const isTruncated = lines.length > maxVisibleLines;
  const visibleValue =
    input.showFull || !isTruncated ? lines.join("\n") : lines.slice(-maxVisibleLines).join("\n");
  const suffix = isTruncated
    ? input.showFull
      ? `${lines.length.toLocaleString()} lines`
      : `last ${maxVisibleLines} of ${lines.length.toLocaleString()} lines`
    : `${lines.length.toLocaleString()} line${lines.length === 1 ? "" : "s"}`;

  return {
    isTruncated,
    visibleValue,
    suffix,
  };
}
