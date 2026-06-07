import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { DiffIcon, FolderTreeIcon } from "lucide-react";
import { useCallback } from "react";

import { stripDiffSearchParams } from "../diffRouteSearch";
import { stripFilesSearchParams } from "../filesRouteSearch";
import { cn } from "~/lib/utils";

type RightPanelMode = "diff" | "files";

// In-panel [Diff | Files] switch. Self-contained: it reads the active mode from
// the route search and navigates to switch the docked right surface between the
// diff and files views without closing it. Rendered in both panel headers.
export function RightPanelModeTabs() {
  const navigate = useNavigate();
  const { environmentId, threadId } = useParams({
    strict: false,
    select: (params) => ({
      environmentId: params.environmentId,
      threadId: params.threadId,
    }),
  });
  const activeMode = useSearch({
    strict: false,
    select: (search): RightPanelMode => (search.files === "1" && search.diff !== "1" ? "files" : "diff"),
  });

  const selectMode = useCallback(
    (mode: RightPanelMode) => {
      if (mode === activeMode || !environmentId || !threadId) {
        return;
      }
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId },
        replace: true,
        search: (previous) => {
          // The two views share the one docked surface, so set one and clear the
          // other. The counterpart must be set to `undefined` (not just omitted):
          // retainSearchParams(["diff","files"]) re-injects an omitted key's prior
          // value, which would leave both set and snap the view back.
          const rest = stripFilesSearchParams(stripDiffSearchParams(previous));
          return mode === "diff"
            ? { ...rest, diff: "1", files: undefined }
            : { ...rest, files: "1", diff: undefined };
        },
      });
    },
    [activeMode, environmentId, navigate, threadId],
  );

  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-border/70 p-0.5 [-webkit-app-region:no-drag]">
      <ModeTabButton
        active={activeMode === "diff"}
        label="Diff"
        icon={<DiffIcon className="size-3" />}
        onClick={() => selectMode("diff")}
      />
      <ModeTabButton
        active={activeMode === "files"}
        label="Files"
        icon={<FolderTreeIcon className="size-3" />}
        onClick={() => selectMode("files")}
      />
    </div>
  );
}

function ModeTabButton(props: {
  active: boolean;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-pressed={props.active}
      className={cn(
        "flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors",
        props.active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      {props.icon}
      <span>{props.label}</span>
    </button>
  );
}
