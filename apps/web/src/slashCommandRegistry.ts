import type { ProviderInteractionMode } from "@t3tools/contracts";
import type { ComponentType } from "react";
import { useSyncExternalStore } from "react";

export type SlashCommandAction =
  | { readonly type: "set-interaction-mode"; readonly mode: ProviderInteractionMode }
  | { readonly type: "trigger-transition"; readonly replacement: string }
  | { readonly type: "prompt-prefix"; readonly prefix: string }
  | { readonly type: "callback"; readonly execute: () => void };

export interface SlashCommandDefinition {
  readonly name: string;
  readonly description: string;
  readonly icon?: ComponentType<{ className?: string }>;
  readonly action: SlashCommandAction;
  readonly standalone?: boolean;
}

type Listener = () => void;

class SlashCommandRegistry {
  private _commands = new Map<string, SlashCommandDefinition>();
  private _snapshot: readonly SlashCommandDefinition[] = [];
  private _names: readonly string[] = [];
  private _standaloneNames: readonly string[] = [];
  private _listeners = new Set<Listener>();

  register(definition: SlashCommandDefinition): () => void {
    this._commands.set(definition.name, definition);
    this._rebuild();
    return () => {
      if (this._commands.get(definition.name) === definition) {
        this._commands.delete(definition.name);
        this._rebuild();
      }
    };
  }

  get(name: string): SlashCommandDefinition | undefined {
    return this._commands.get(name);
  }

  getAll(): readonly SlashCommandDefinition[] {
    return this._snapshot;
  }

  getNames(): readonly string[] {
    return this._names;
  }

  getStandaloneNames(): readonly string[] {
    return this._standaloneNames;
  }

  has(name: string): boolean {
    return this._commands.has(name);
  }

  match(query: string): readonly SlashCommandDefinition[] {
    const q = query.toLowerCase();
    if (!q) return this._snapshot;
    return this._snapshot.filter((cmd) => cmd.name.includes(q));
  }

  subscribe = (listener: Listener): (() => void) => {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  };

  getSnapshot = (): readonly SlashCommandDefinition[] => {
    return this._snapshot;
  };

  private _rebuild(): void {
    this._snapshot = Array.from(this._commands.values());
    this._names = this._snapshot.map((c) => c.name);
    this._standaloneNames = this._snapshot.filter((c) => c.standalone).map((c) => c.name);
    for (const listener of this._listeners) {
      listener();
    }
  }
}

export const slashCommandRegistry = new SlashCommandRegistry();

slashCommandRegistry.register({
  name: "model",
  description: "Switch response model for this thread",
  action: { type: "trigger-transition", replacement: "/model " },
});

slashCommandRegistry.register({
  name: "plan",
  description: "Switch this thread into plan mode",
  action: { type: "set-interaction-mode", mode: "plan" },
  standalone: true,
});

slashCommandRegistry.register({
  name: "default",
  description: "Switch this thread back to normal chat mode",
  action: { type: "set-interaction-mode", mode: "default" },
  standalone: true,
});

export function useSlashCommands(): readonly SlashCommandDefinition[] {
  return useSyncExternalStore(
    slashCommandRegistry.subscribe,
    slashCommandRegistry.getSnapshot,
    slashCommandRegistry.getSnapshot,
  );
}
