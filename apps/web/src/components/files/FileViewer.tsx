import { type EnvironmentId, type FilesystemReadFileResult } from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import { Loader2Icon } from "lucide-react";
import { Suspense, use, useMemo } from "react";

import { readEnvironmentApi } from "../../environmentApi";
import { getHighlighterPromise } from "../../lib/codeHighlighter";
import { resolveDiffThemeName } from "../../lib/diffRendering";

const FILE_VIEWER_STALE_TIME_MS = 15_000;

// Maps file extensions / well-known filenames to a shiki language id. Anything
// not listed falls back to "text" (and getHighlighterPromise degrades further
// if shiki has no grammar for the resolved language).
const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "jsonc",
  json5: "json5",
  md: "markdown",
  mdx: "mdx",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  htm: "html",
  xml: "xml",
  svg: "xml",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  ini: "ini",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  fish: "fish",
  py: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  vue: "vue",
  svelte: "svelte",
  astro: "astro",
  dockerfile: "docker",
  lua: "lua",
  dart: "dart",
  // Shiki doesn't bundle a gitignore grammar; ini is a close match (#685)
  gitignore: "ini",
};

const FILENAME_LANGUAGE_MAP: Record<string, string> = {
  dockerfile: "docker",
  makefile: "make",
  ".gitignore": "ini",
  ".npmrc": "ini",
  ".env": "dotenv",
};

function inferLanguageFromPath(relativePath: string): string {
  const segments = relativePath.replaceAll("\\", "/").split("/");
  const basename = (segments[segments.length - 1] ?? "").toLowerCase();
  const byFilename = FILENAME_LANGUAGE_MAP[basename];
  if (byFilename) {
    return byFilename;
  }
  const dotIndex = basename.lastIndexOf(".");
  if (dotIndex <= 0) {
    return "text";
  }
  const extension = basename.slice(dotIndex + 1);
  return EXTENSION_LANGUAGE_MAP[extension] ?? "text";
}

function FileViewerMessage(props: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center">
      <p className="font-mono text-xs text-muted-foreground/80">{props.children}</p>
    </div>
  );
}

function HighlightedFileContent(props: {
  content: string;
  language: string;
  theme: "light" | "dark";
}) {
  const { content, language, theme } = props;
  const themeName = resolveDiffThemeName(theme);
  const highlighter = use(getHighlighterPromise(language));
  const highlightedHtml = useMemo(() => {
    try {
      return highlighter.codeToHtml(content, { lang: language, theme: themeName });
    } catch (error) {
      console.warn(
        `File highlighting failed for language "${language}", falling back to plain text.`,
        error instanceof Error ? error.message : error,
      );
      return highlighter.codeToHtml(content, { lang: "text", theme: themeName });
    }
  }, [content, highlighter, language, themeName]);

  return (
    <div
      className="file-viewer-shiki min-h-0 flex-1 overflow-auto text-[12px] leading-[1.6]"
      dangerouslySetInnerHTML={{ __html: highlightedHtml }}
    />
  );
}

export function FileViewer(props: {
  environmentId: EnvironmentId;
  cwd: string;
  relativePath: string | null;
  theme: "light" | "dark";
}) {
  const { cwd, environmentId, relativePath, theme } = props;
  const query = useQuery({
    queryKey: ["filesystemReadFile", environmentId, cwd, relativePath],
    queryFn: async (): Promise<FilesystemReadFileResult> => {
      const api = readEnvironmentApi(environmentId);
      if (!api || relativePath === null) {
        return { content: "", truncated: false, tooLarge: false, binary: false };
      }
      return api.filesystem.readFile({ cwd, relativePath });
    },
    staleTime: FILE_VIEWER_STALE_TIME_MS,
    enabled: relativePath !== null,
  });

  const language = useMemo(
    () => (relativePath ? inferLanguageFromPath(relativePath) : "text"),
    [relativePath],
  );

  if (relativePath === null) {
    return <FileViewerMessage>Select a file to preview its contents.</FileViewerMessage>;
  }

  if (query.isPending) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-muted-foreground/70">
        <Loader2Icon className="size-4 animate-spin" />
      </div>
    );
  }

  if (query.isError) {
    return <FileViewerMessage>Could not read this file.</FileViewerMessage>;
  }

  const result = query.data;
  if (result.binary) {
    return <FileViewerMessage>Binary file not shown.</FileViewerMessage>;
  }
  if (result.tooLarge) {
    return <FileViewerMessage>File too large to preview.</FileViewerMessage>;
  }
  if (result.content.length === 0) {
    return <FileViewerMessage>This file is empty.</FileViewerMessage>;
  }

  return (
    <Suspense
      fallback={
        <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-muted-foreground/70">
          <Loader2Icon className="size-4 animate-spin" />
        </div>
      }
    >
      <HighlightedFileContent content={result.content} language={language} theme={theme} />
    </Suspense>
  );
}
