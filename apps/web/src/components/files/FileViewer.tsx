import { type EnvironmentId, type FilesystemReadFileResult } from "@t3tools/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, Loader2Icon, PencilIcon, XIcon } from "lucide-react";
import { Suspense, use, useCallback, useEffect, useMemo, useState } from "react";

import { readEnvironmentApi } from "../../environmentApi";
import { getHighlighterPromise } from "../../lib/codeHighlighter";
import { resolveDiffThemeName } from "../../lib/diffRendering";
import { cn } from "~/lib/utils";

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

const READ_FILE_QUERY_KEY = "filesystemReadFile";

function ViewerSpinner() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-muted-foreground/70">
      <Loader2Icon className="size-4 animate-spin" />
    </div>
  );
}

// Holds all edit state. Keyed by relativePath in the parent so switching files
// remounts this with a clean slate (no stale draft leaking across files).
function EditableFileView(props: {
  environmentId: EnvironmentId;
  cwd: string;
  relativePath: string;
  diskContent: string;
  language: string;
  theme: "light" | "dark";
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { cwd, diskContent, environmentId, language, onDirtyChange, relativePath, theme } = props;
  const queryClient = useQueryClient();

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(diskContent);
  // The content we last loaded or saved; the save concurrency-check compares
  // the on-disk content against this to detect external (agent) edits.
  const [baseline, setBaseline] = useState(diskContent);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  // While not editing, keep the draft in sync with refetched disk content.
  useEffect(() => {
    if (!isEditing) {
      setDraft(diskContent);
      setBaseline(diskContent);
    }
  }, [diskContent, isEditing]);

  const dirty = isEditing && draft !== baseline;

  // Report dirty state up so the panel can guard file switches, and clear it on unmount.
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  // Warn before closing/reloading the app with unsaved edits.
  useEffect(() => {
    if (!dirty) {
      return;
    }
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const handleSave = useCallback(async () => {
    if (isSaving) {
      return;
    }
    const api = readEnvironmentApi(environmentId);
    if (!api) {
      setSaveError("This environment is not connected.");
      return;
    }
    setSaveError(null);
    setIsSaving(true);
    try {
      // Concurrency guard: refuse to silently clobber edits made on disk
      // (e.g. by the agent) since we opened the file.
      const latest = await api.filesystem.readFile({ cwd, relativePath });
      if (!latest.binary && !latest.tooLarge && latest.content !== baseline) {
        const overwrite = window.confirm(
          "This file changed on disk since you opened it. Overwrite those changes?",
        );
        if (!overwrite) {
          setIsSaving(false);
          return;
        }
      }
      await api.projects.writeFile({ cwd, relativePath, contents: draft });
      setBaseline(draft);
      setJustSaved(true);
      await queryClient.invalidateQueries({
        queryKey: [READ_FILE_QUERY_KEY, environmentId, cwd, relativePath],
      });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save this file.");
    } finally {
      setIsSaving(false);
    }
  }, [baseline, cwd, draft, environmentId, isSaving, queryClient, relativePath]);

  const handleCancel = useCallback(() => {
    if (dirty && !window.confirm("Discard unsaved changes?")) {
      return;
    }
    setDraft(baseline);
    setSaveError(null);
    setIsEditing(false);
  }, [baseline, dirty]);

  const onTextareaKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "s") {
        event.preventDefault();
        if (dirty) {
          void handleSave();
        }
      }
    },
    [dirty, handleSave],
  );

  const isEmpty = diskContent.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center justify-end gap-2 border-b border-border/60 px-2">
        {saveError ? (
          <span className="truncate font-mono text-[11px] text-destructive" title={saveError}>
            {saveError}
          </span>
        ) : null}
        {isEditing ? (
          <>
            {dirty ? (
              <span
                className="size-1.5 rounded-full bg-amber-500"
                aria-label="Unsaved changes"
                title="Unsaved changes"
              />
            ) : justSaved ? (
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground/80">
                <CheckIcon className="size-3" /> Saved
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!dirty || isSaving}
              className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-accent disabled:opacity-40"
            >
              {isSaving ? <Loader2Icon className="size-3 animate-spin" /> : null}
              Save
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={isSaving}
              className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent disabled:opacity-40"
            >
              <XIcon className="size-3" /> Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => {
              setJustSaved(false);
              setDraft(baseline);
              setIsEditing(true);
            }}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <PencilIcon className="size-3" /> Edit
          </button>
        )}
      </div>

      {isEditing ? (
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onTextareaKeyDown}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          className={cn(
            "min-h-0 flex-1 resize-none bg-background p-3 font-mono text-[12px] leading-[1.6]",
            "text-foreground outline-none",
          )}
        />
      ) : isEmpty ? (
        <FileViewerMessage>This file is empty.</FileViewerMessage>
      ) : (
        <Suspense fallback={<ViewerSpinner />}>
          <HighlightedFileContent content={diskContent} language={language} theme={theme} />
        </Suspense>
      )}
    </div>
  );
}

export function FileViewer(props: {
  environmentId: EnvironmentId;
  cwd: string;
  relativePath: string | null;
  theme: "light" | "dark";
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { cwd, environmentId, onDirtyChange, relativePath, theme } = props;
  const query = useQuery({
    queryKey: [READ_FILE_QUERY_KEY, environmentId, cwd, relativePath],
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
    return <ViewerSpinner />;
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

  return (
    <EditableFileView
      key={relativePath}
      environmentId={environmentId}
      cwd={cwd}
      relativePath={relativePath}
      diskContent={result.content}
      language={language}
      theme={theme}
      {...(onDirtyChange ? { onDirtyChange } : {})}
    />
  );
}
