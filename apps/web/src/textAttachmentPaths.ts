const UUID_PATH_SEGMENT = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const TEXT_ATTACHMENT_PATH_PATTERN = new RegExp(
  `(?:^|[\\\\/])(?:\\.t3[\\\\/]attachments|attachments[\\\\/]text)[\\\\/]${UUID_PATH_SEGMENT}[\\\\/]`,
  "i",
);
const LEGACY_FLAT_TEXT_ATTACHMENT_PATH_PATTERN = new RegExp(
  `(?:^|[\\\\/])\\.t3[\\\\/]attachments[\\\\/]${UUID_PATH_SEGMENT}-[^\\\\/]+$`,
  "i",
);
export function isTextAttachmentPath(path: string): boolean {
  return (
    TEXT_ATTACHMENT_PATH_PATTERN.test(path) || LEGACY_FLAT_TEXT_ATTACHMENT_PATH_PATTERN.test(path)
  );
}

export function textAttachmentPaths(prompt: string): string[] {
  const paths = new Set<string>();
  for (const encodedPath of markdownLinkDestinations(prompt)) {
    let path = encodedPath;
    try {
      path = decodeURIComponent(encodedPath);
    } catch {
      // Preserve malformed source rather than dropping a generated path.
    }
    if (isTextAttachmentPath(path)) paths.add(path);
  }
  return [...paths];
}

export function removedTextAttachmentPaths(previousPrompt: string, nextPrompt: string): string[] {
  const nextPaths = new Set(textAttachmentPaths(nextPrompt));
  return textAttachmentPaths(previousPrompt).filter((path) => !nextPaths.has(path));
}

export function unreferencedTextAttachmentPaths(
  discardedPrompts: ReadonlyArray<string>,
  retainedPrompts: ReadonlyArray<string>,
): string[] {
  const retainedPaths = new Set(retainedPrompts.flatMap(textAttachmentPaths));
  return [
    ...new Set(
      discardedPrompts.flatMap(textAttachmentPaths).filter((path) => !retainedPaths.has(path)),
    ),
  ];
}
import { markdownLinkDestinations } from "@t3tools/shared/markdownLinks";
