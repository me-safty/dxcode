import { useQuery } from "@tanstack/react-query";
import { memo, useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { projectReadFileQueryOptions } from "~/lib/projectReactQuery";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogPanel,
} from "~/components/ui/dialog";

interface FileViewerModalProps {
  cwd: string | null;
  relativePath: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Convert single newlines to double so markdown renders line breaks as separate lines. */
function normalizeLineBreaks(text: string): string {
  return text.replace(/(?<!\n)\n(?!\n)/g, "\n\n");
}

export const FileViewerModal = memo(function FileViewerModal({
  cwd,
  relativePath,
  open,
  onOpenChange,
}: FileViewerModalProps) {
  const fileQuery = useQuery(
    projectReadFileQueryOptions({
      cwd,
      relativePath,
      enabled: open,
    }),
  );

  const fileName = relativePath?.split("/").pop() ?? "File";
  const contents = useMemo(
    () => normalizeLineBreaks(fileQuery.data?.contents ?? ""),
    [fileQuery.data?.contents],
  );

  const handleOpenChange = useCallback(
    (_open: boolean) => {
      onOpenChange(_open);
    },
    [onOpenChange],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">{fileName}</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          {fileQuery.isPending ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : fileQuery.isError ? (
            <p className="text-sm text-destructive">
              Failed to read file: {fileQuery.error.message}
            </p>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{contents}</ReactMarkdown>
            </div>
          )}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
});
