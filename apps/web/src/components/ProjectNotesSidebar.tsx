import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { ProjectId } from "@t3tools/contracts";
import { PanelRightCloseIcon } from "lucide-react";

import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

interface ProjectNotesSidebarProps {
  projectId: ProjectId;
  projectName: string;
  notes: string;
  onNotesChange: (notes: string) => void;
  onClose: () => void;
}

const DEBOUNCE_MS = 500;

const ProjectNotesSidebar = memo(function ProjectNotesSidebar({
  projectId,
  projectName,
  notes,
  onNotesChange,
  onClose,
}: ProjectNotesSidebarProps) {
  const [localNotes, setLocalNotes] = useState(notes);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingValueRef = useRef<string | null>(null);

  useEffect(() => {
    setLocalNotes(notes);
  }, [projectId, notes]);

  const flushPendingChange = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (pendingValueRef.current === null) {
      return;
    }
    const nextValue = pendingValueRef.current;
    pendingValueRef.current = null;
    onNotesChange(nextValue);
  }, [onNotesChange]);

  useEffect(() => {
    return () => {
      flushPendingChange();
    };
  }, [projectId, flushPendingChange]);

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value;
      setLocalNotes(value);
      pendingValueRef.current = value;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        flushPendingChange();
      }, DEBOUNCE_MS);
    },
    [flushPendingChange],
  );

  return (
    <div className="flex h-full w-[340px] shrink-0 flex-col border-l border-border/70 bg-card/50">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge
            variant="secondary"
            className="shrink-0 rounded-md bg-amber-500/10 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide text-amber-400"
          >
            Notes
          </Badge>
          <span className="min-w-0 truncate text-[11px] text-muted-foreground/60">
            {projectName}
          </span>
        </div>
        <Button
          size="icon-xs"
          variant="ghost"
          className="shrink-0 text-muted-foreground/50 hover:text-foreground/70"
          onClick={() => {
            flushPendingChange();
            onClose();
          }}
          aria-label="Close notes sidebar"
        >
          <PanelRightCloseIcon className="size-3.5" />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col p-3">
        <textarea
          className="min-h-0 flex-1 resize-none rounded-md border border-border/40 bg-background/50 p-3 font-mono text-sm text-foreground placeholder:text-muted-foreground/40 focus:border-border focus:outline-none"
          value={localNotes}
          onChange={handleChange}
          placeholder="Jot down ideas, todos, or notes for this project..."
        />
      </div>
    </div>
  );
});

export default ProjectNotesSidebar;
