import type { ThreadId } from "@t3tools/contracts";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";

import {
  type CommandTrayButton,
  useCommandTrayStore,
} from "~/commandTrayStore";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
  DialogClose,
} from "~/components/ui/dialog";

interface CommandTrayProps {
  threadId: ThreadId | null;
  terminalId: string;
}

function CommandTray({ threadId, terminalId }: CommandTrayProps) {
  const buttons = useCommandTrayStore((state) => state.buttons);
  const [editOpen, setEditOpen] = useState(false);

  const sendCommand = useCallback(
    (btn: CommandTrayButton) => {
      if (!btn.command || !threadId) return;
      if (btn.target === "terminal") {
        // Write directly to the active terminal
        window.dispatchEvent(
          new CustomEvent("commandTrayTerminalSubmit", {
            detail: { command: btn.command, threadId, terminalId },
          }),
        );
      } else {
        // Default: submit as a chat message
        const text = btn.command.replace(/\n$/, "");
        if (!text) return;
        window.dispatchEvent(
          new CustomEvent("commandTraySubmit", { detail: { command: text } }),
        );
      }
    },
    [threadId, terminalId],
  );

  return (
    <div className="flex shrink-0 items-center gap-1 px-2 py-1 border-t border-border bg-card">
      {buttons.map((btn) => (
        <button
          key={btn.id}
          type="button"
          onClick={() => void sendCommand(btn)}
          disabled={!btn.command || !threadId}
          className="px-2 py-0.5 text-xs rounded bg-muted hover:bg-accent text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {btn.label}
        </button>
      ))}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <button
          type="button"
          onClick={() => setEditOpen(true)}
          className="ml-auto p-1 rounded hover:bg-accent text-muted-foreground transition-colors"
          aria-label="Edit command tray"
        >
          <Pencil size={14} />
        </button>
        <EditCommandTrayDialog onClose={() => setEditOpen(false)} />
      </Dialog>
    </div>
  );
}

function EditCommandTrayDialog({ onClose }: { onClose: () => void }) {
  const buttons = useCommandTrayStore((state) => state.buttons);
  const addButton = useCommandTrayStore((state) => state.addButton);
  const removeButton = useCommandTrayStore((state) => state.removeButton);
  const updateButton = useCommandTrayStore((state) => state.updateButton);
  const resetToDefaults = useCommandTrayStore((state) => state.resetToDefaults);

  const [newLabel, setNewLabel] = useState("");
  const [newCommand, setNewCommand] = useState("");

  const handleAdd = () => {
    const label = newLabel.trim();
    const command = newCommand.trim();
    if (!label) return;
    addButton({
      id: `custom-${Date.now()}`,
      label,
      command: command ? `${command}\n` : "",
    });
    setNewLabel("");
    setNewCommand("");
  };

  return (
    <DialogPopup className="max-w-md">
      <DialogHeader>
        <DialogTitle>Edit Command Tray</DialogTitle>
        <DialogDescription>
          Customize the command buttons shown at the bottom of the chat.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <div className="flex flex-col gap-3">
          {buttons.map((btn) => (
            <div key={btn.id} className="flex items-center gap-2">
              <Input
                value={btn.label}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  updateButton(btn.id, {
                    label: (e.target as HTMLInputElement).value,
                  })
                }
                placeholder="Label"
                size="sm"
                className="flex-1"
              />
              <Input
                value={btn.command.replace(/\n$/, "")}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  updateButton(btn.id, {
                    command: (e.target as HTMLInputElement).value
                      ? `${(e.target as HTMLInputElement).value}\n`
                      : "",
                  })
                }
                placeholder="Command"
                size="sm"
                className="flex-1"
              />
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => removeButton(btn.id)}
                aria-label={`Remove ${btn.label}`}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-2 border-t border-border">
            <Input
              value={newLabel}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setNewLabel((e.target as HTMLInputElement).value)
              }
              placeholder="New label"
              size="sm"
              className="flex-1"
              onKeyDown={(e: React.KeyboardEvent) => {
                if (e.key === "Enter") handleAdd();
              }}
            />
            <Input
              value={newCommand}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setNewCommand((e.target as HTMLInputElement).value)
              }
              placeholder="New command"
              size="sm"
              className="flex-1"
              onKeyDown={(e: React.KeyboardEvent) => {
                if (e.key === "Enter") handleAdd();
              }}
            />
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={handleAdd}
              aria-label="Add button"
            >
              <Plus size={14} />
            </Button>
          </div>
        </div>
      </DialogPanel>
      <DialogFooter variant="bare">
        <Button variant="outline" size="sm" onClick={resetToDefaults}>
          Reset to Defaults
        </Button>
        <DialogClose render={<Button size="sm">Done</Button>} />
      </DialogFooter>
    </DialogPopup>
  );
}

export default CommandTray;
