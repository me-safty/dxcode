import { LanguageDescription, type LanguageSupport } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import type { Extension } from "@codemirror/state";

/**
 * Resolve a CodeMirror language extension for a file name.
 *
 * Languages from `@codemirror/language-data` are loaded lazily (dynamic import)
 * so the IDE only pulls in the grammars it actually uses. Returns an empty
 * extension when no language matches (the file is highlighted as plain text).
 */
export async function loadLanguageForFile(fileName: string): Promise<Extension> {
  const description = matchLanguageDescription(fileName);
  if (!description) {
    return [];
  }
  try {
    const support: LanguageSupport = await description.load();
    return support;
  } catch {
    return [];
  }
}

function matchLanguageDescription(fileName: string): LanguageDescription | null {
  const byFilename = LanguageDescription.matchFilename(languages, fileName);
  if (byFilename) {
    return byFilename;
  }
  // Fall back to the extension token (matchFilename already covers this, but
  // keep a defensive lookup for dotfiles like ".gitignore").
  const extension = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".") + 1) : "";
  if (!extension) {
    return null;
  }
  return LanguageDescription.matchLanguageName(languages, extension, true);
}
