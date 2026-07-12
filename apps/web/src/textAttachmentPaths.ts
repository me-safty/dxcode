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

export function removedTextAttachmentPaths(previousPrompt: string, nextPrompt: string): string[] {
  const collect = (prompt: string) =>
    new Set(
      collectComposerInlineTokens(prompt).flatMap((token) =>
        token.type === "mention" && isTextAttachmentPath(token.value) ? [token.value] : [],
      ),
    );
  const previousPaths = collect(previousPrompt);
  const nextPaths = collect(nextPrompt);
  return [...previousPaths].filter((path) => !nextPaths.has(path));
}
import { collectComposerInlineTokens } from "@t3tools/shared/composerInlineTokens";
