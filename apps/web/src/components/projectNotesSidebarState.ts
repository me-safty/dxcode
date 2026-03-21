export interface ShouldSyncProjectNotesInputParams {
  projectChanged: boolean;
  isTextareaFocused: boolean;
  hasPendingLocalChange: boolean;
}

export function shouldSyncProjectNotesInput({
  projectChanged,
  isTextareaFocused,
  hasPendingLocalChange,
}: ShouldSyncProjectNotesInputParams): boolean {
  if (projectChanged) {
    return true;
  }
  if (!isTextareaFocused) {
    return true;
  }
  return !hasPendingLocalChange;
}
