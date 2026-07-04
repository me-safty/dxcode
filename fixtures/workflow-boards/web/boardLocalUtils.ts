// Board-domain helpers that are plugin-local (not part of the host surface).
// `nextDefaultBoardName` was ported from the host's `components/Sidebar.logic.ts`
// because it is board-specific and lives only in this plugin.

export function nextDefaultBoardName(existingNames: readonly string[]): string {
  const existing = new Set(existingNames);
  const baseName = "Workflow board";
  if (!existing.has(baseName)) {
    return baseName;
  }
  for (let index = 2; ; index += 1) {
    const candidate = `${baseName} ${index}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
  }
}
