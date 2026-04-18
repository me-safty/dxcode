import { SquarePenIcon, TerminalIcon } from "lucide-react";
import { type CSSProperties, type ReactNode } from "react";
import ChatMarkdown from "../ChatMarkdown";

const SAMPLE_MARKDOWN = `Sure — here's the refactor:

- Extracted validation into a guard clause
- Removed two levels of nesting
- Returns \`null\` when inputs are empty

\`\`\`ts
function example(): boolean {
  return true;
}
\`\`\`
`;

interface ChatFontSizePreviewProps {
  fontSize: number;
}

/**
 * Decorative, read-only preview used in the Appearance settings panel so
 * users can see how `chatFontSize` affects the live chat before committing.
 *
 * Every text tier the real timeline uses is exercised here so scaling is
 * visible end-to-end:
 *  - `text-chat-mini`  — work-log section header
 *  - `text-chat-xs`    — tool-row heading, user-bubble timestamp
 *  - `text-chat-xxs`   — tool-row preview text
 *  - `text-chat-xxxs`  — changed-file chip, assistant meta line
 *  - `text-chat-body`  — user/assistant message bodies
 * Plus `ChatMarkdown`, whose `.chat-markdown` rules in `index.css` scale
 * via `[data-timeline-root]` — set here on the wrapper along with
 * `--chat-font-size`, mirroring what MessagesTimeline does on its rows.
 */
export function ChatFontSizePreview({ fontSize }: ChatFontSizePreviewProps) {
  return (
    <div
      aria-hidden
      data-timeline-root="true"
      style={{ "--chat-font-size": `${fontSize}px` } as CSSProperties}
      className="space-y-3 rounded-md border border-border/60 bg-muted/40 px-3 py-3"
    >
      <PreviewWorkLog />
      <div className="flex justify-end">
        <div className="relative max-w-[80%] rounded-2xl rounded-br-sm border border-border bg-secondary px-4 py-3">
          <div className="whitespace-pre-wrap wrap-break-word text-chat-body leading-relaxed text-foreground">
            Can you refactor this function to use early returns?
          </div>
          <p className="mt-1.5 text-right text-chat-xs text-muted-foreground/50">09:45</p>
        </div>
      </div>
      <div className="min-w-0 px-1 py-0.5">
        <ChatMarkdown text={SAMPLE_MARKDOWN} cwd={undefined} isStreaming={false} />
        <p className="mt-1.5 text-chat-xxxs text-muted-foreground/30">Just now • 1.2s</p>
      </div>
    </div>
  );
}

function PreviewWorkLog() {
  return (
    <div className="rounded-xl border border-border/45 bg-card/25 px-2 py-1.5">
      <div className="mb-1.5 px-0.5">
        <p className="text-chat-mini uppercase tracking-[0.16em] text-muted-foreground/55">
          Tool calls (2)
        </p>
      </div>
      <div className="space-y-0.5">
        <PreviewWorkRow
          icon={<TerminalIcon className="size-3" />}
          heading="Bash"
          preview="ls -la src/"
        />
        <PreviewWorkRow
          icon={<SquarePenIcon className="size-3" />}
          heading="Edit"
          preview="src/components/Button.tsx"
          changedFile="src/components/Button.tsx"
        />
      </div>
    </div>
  );
}

function PreviewWorkRow({
  icon,
  heading,
  preview,
  changedFile,
}: {
  icon: ReactNode;
  heading: string;
  preview: string;
  changedFile?: string;
}) {
  return (
    <div className="rounded-lg px-1 py-1">
      <div className="flex items-center gap-2">
        <span className="flex size-5 shrink-0 items-center justify-center text-foreground/92">
          {icon}
        </span>
        <div className="min-w-0 flex-1 overflow-hidden">
          <p className="truncate text-chat-xs leading-5 text-muted-foreground/70">
            <span className="text-foreground/80">{heading}</span>
            <span className="text-muted-foreground/55"> - {preview}</span>
          </p>
        </div>
      </div>
      {changedFile ? (
        <div className="mt-1 flex flex-wrap gap-1 pl-6">
          <span className="rounded-md border border-border/55 bg-background/75 px-1.5 py-0.5 font-mono text-chat-xxxs text-muted-foreground/75">
            {changedFile}
          </span>
        </div>
      ) : null}
    </div>
  );
}
