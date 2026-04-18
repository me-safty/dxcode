import { memo, useMemo, useState } from "react";
import { getVscodeIconUrlForEntry } from "../../vscode-icons";
import { FileIcon } from "lucide-react";
import { cn } from "~/lib/utils";

const WorkspaceFolderIcon = memo(function WorkspaceFolderIcon(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 256 256"
      aria-hidden="true"
      className={cn("size-4 shrink-0", props.className)}
      fill="currentColor"
    >
      <path d="M224 64h-69.33l-27.74-20.8a16.12 16.12 0 0 0-9.6-3.2H72a16 16 0 0 0-16 16v16H40a16 16 0 0 0-16 16v112a16 16 0 0 0 16 16h152.89A15.13 15.13 0 0 0 208 200.89V184h16.89A15.13 15.13 0 0 0 240 168.89V80a16 16 0 0 0-16-16Zm-32 136H40V88h45.33l27.74 20.8a16.12 16.12 0 0 0 9.6 3.2H192Zm32-32h-16v-56a16 16 0 0 0-16-16h-69.33L94.93 75.2a16.12 16.12 0 0 0-9.6-3.2H72V56h45.33l27.74 20.8a16.12 16.12 0 0 0 9.6 3.2H224Z" />
    </svg>
  );
});

export const VscodeEntryIcon = memo(function VscodeEntryIcon(props: {
  pathValue: string;
  kind: "file" | "directory";
  theme: "light" | "dark";
  className?: string;
}) {
  const [failedIconUrl, setFailedIconUrl] = useState<string | null>(null);
  const iconUrl = useMemo(
    () => getVscodeIconUrlForEntry(props.pathValue, props.kind, props.theme),
    [props.kind, props.pathValue, props.theme],
  );
  const failed = failedIconUrl === iconUrl;

  if (props.kind === "directory") {
    return (
      <WorkspaceFolderIcon className={cn("size-4 text-muted-foreground/80", props.className)} />
    );
  }

  if (failed) {
    return <FileIcon className={cn("size-4 text-muted-foreground/80", props.className)} />;
  }

  return (
    <img
      src={iconUrl}
      alt=""
      aria-hidden="true"
      className={cn("size-4 shrink-0", props.className)}
      loading="lazy"
      onError={() => setFailedIconUrl(iconUrl)}
    />
  );
});
