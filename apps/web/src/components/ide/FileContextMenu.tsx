import { useEffect, useRef } from "react";

import type { EnvironmentId, ProjectId, ProjectTreeEntry } from "@t3tools/contracts";

import { entryPinId, usePinnedItemsStore } from "../../pinnedItemsStore";

export interface FileMenuTarget {
  entry: ProjectTreeEntry;
  x: number;
  y: number;
}

interface FileContextMenuProps {
  target: FileMenuTarget;
  environmentId: EnvironmentId;
  projectId: ProjectId;
  /** Absolute workspace root, for the absolute-path copy action. */
  cwd: string;
  onOpen: (entry: ProjectTreeEntry) => void;
  onClose: () => void;
}

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(idx + 1) : path;
}

function joinAbsolute(cwd: string, relativePath: string): string {
  return `${cwd.replace(/\/+$/, "")}/${relativePath}`;
}

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard may be unavailable (permissions); silently ignore.
  }
}

/**
 * VS Code-style right-click menu for a file/folder in the editor explorer.
 */
export function FileContextMenu(props: FileContextMenuProps) {
  const { target, environmentId, projectId, cwd, onOpen, onClose } = props;
  const { entry } = target;
  const ref = useRef<HTMLDivElement | null>(null);

  const pinEntry = usePinnedItemsStore((state) => state.pinEntry);
  const unpin = usePinnedItemsStore((state) => state.unpin);
  const pinId = entryPinId(environmentId, projectId, entry.path);
  const isPinned = usePinnedItemsStore((state) => state.items.some((item) => item.id === pinId));

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  const items: Array<{ label: string; run: () => void } | "separator"> = [];
  if (entry.kind === "file") {
    items.push({ label: "Open", run: () => onOpen(entry) });
    items.push("separator");
  }
  items.push({
    label: isPinned ? "Unpin from Sidebar" : "Pin to Sidebar",
    run: () =>
      isPinned
        ? unpin(pinId)
        : pinEntry({
            environmentId,
            projectId,
            cwd,
            path: entry.path,
            name: basename(entry.path),
            kind: entry.kind,
          }),
  });
  items.push("separator");
  items.push({ label: "Copy Path", run: () => void copy(joinAbsolute(cwd, entry.path)) });
  items.push({ label: "Copy Relative Path", run: () => void copy(entry.path) });
  items.push({ label: "Copy Name", run: () => void copy(basename(entry.path)) });

  // Keep the menu within the viewport.
  const left = Math.min(target.x, window.innerWidth - 220);
  const top = Math.min(target.y, window.innerHeight - (items.length * 30 + 8));

  return (
    <div
      ref={ref}
      role="menu"
      style={{ left, top }}
      className="fixed z-50 min-w-44 overflow-hidden rounded-md border border-border bg-popover py-1 text-sm text-popover-foreground shadow-lg"
    >
      {items.map((item, index) =>
        item === "separator" ? (
          <div key={`sep-${index}`} className="my-1 h-px bg-border" />
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            onClick={() => {
              item.run();
              onClose();
            }}
            className="flex w-full items-center px-3 py-1 text-left hover:bg-accent hover:text-foreground"
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
