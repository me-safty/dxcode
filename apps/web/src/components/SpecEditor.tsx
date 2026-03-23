import { useCallback, useEffect, useRef, useState } from "react";
import { ensureNativeApi } from "~/nativeApi";
import type { ProjectId } from "@t3tools/contracts";

interface SpecEditorProps {
  projectId: ProjectId;
  className?: string;
}

export function SpecEditor({ projectId, className }: SpecEditorProps) {
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load spec on mount
  useEffect(() => {
    ensureNativeApi()
      .spec.get({ projectId })
      .then((spec) => {
        if (spec) setContent(spec.content);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [projectId]);

  // Debounced auto-save
  const handleChange = useCallback(
    (newContent: string) => {
      setContent(newContent);
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        setSaving(true);
        ensureNativeApi()
          .spec.update({ projectId, content: newContent })
          .then(() => setSaving(false))
          .catch(() => setSaving(false));
      }, 1000);
    },
    [projectId],
  );

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  if (!loaded) {
    return <div className="px-2 py-1 text-xs text-muted-foreground">Loading spec...</div>;
  }

  return (
    <div className={className}>
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-[10px] font-medium text-muted-foreground">Spec / Plan</span>
        {saving && <span className="text-[10px] text-muted-foreground">Saving...</span>}
      </div>
      <textarea
        className="w-full resize-y rounded border border-border bg-background/50 px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono"
        placeholder="Write your spec or planning notes here..."
        rows={6}
        value={content}
        onChange={(e) => handleChange(e.target.value)}
      />
    </div>
  );
}
