// Matches the synthetic "Initializing snapshot…" progress parts published by the
// Kilo SDK while it initializes the file snapshot used for undo/redo. The SDK
// (see `PROGRESS_INITIALIZING` in `@kilocode/sdk`) emits an ordinary text part
// whose full content is `{spinner} Initializing snapshot…`, where the spinner
// is a braille pattern character from the block U+2800..U+28FF. The frame is
// replaced in-place as the snapshot job progresses, so each frame arrives as a
// full replacement of the previous text rather than a delta.
//
// We tolerate:
// - zero or more braille frames (so empty spinner placeholders also match),
// - trailing whitespace,
// - either `…` (U+2026) or one or more `.` characters as the trailing
//   ellipsis, since the UI font sometimes renders the ellipsis as three dots.
//
// The pattern is anchored (`^…$`) so it only matches when the entire text is
// the progress marker — a sentence that happens to contain the phrase
// "Initializing snapshot…" is unaffected.
const KILO_SNAPSHOT_PROGRESS_PATTERN = /^\s*[\u2800-\u28FF]*\s*Initializing snapshot[….]+\s*$/u;

export function isKiloSnapshotProgressText(text: string): boolean {
  return KILO_SNAPSHOT_PROGRESS_PATTERN.test(text);
}
