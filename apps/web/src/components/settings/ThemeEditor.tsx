"use client";

import { useEffect, useMemo, useState } from "react";

import { cn } from "../../lib/utils";
import {
  isValidColorValue,
  isValidTheme,
  previewTheme,
  restoreActiveThemes,
} from "../../themes/registry";
import {
  THEME_TOKEN_NAMES,
  type ThemeDefinition,
  type ThemeTokenName,
  type ThemeTokens,
  type ThemeVariant,
} from "../../themes/types";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Toggle, ToggleGroup } from "../ui/toggle-group";

type Mode = "form" | "json";

type TokenCategory = {
  title: string;
  tokens: ReadonlyArray<ThemeTokenName>;
};

const TOKEN_CATEGORIES: ReadonlyArray<TokenCategory> = [
  {
    title: "Surfaces",
    tokens: [
      "background",
      "app-chrome-background",
      "foreground",
      "card",
      "card-foreground",
      "popover",
      "popover-foreground",
    ],
  },
  {
    title: "Brand & focus",
    tokens: ["primary", "primary-foreground", "ring"],
  },
  {
    title: "Neutrals",
    tokens: [
      "secondary",
      "secondary-foreground",
      "muted",
      "muted-foreground",
      "accent",
      "accent-foreground",
    ],
  },
  {
    title: "Status",
    tokens: [
      "destructive",
      "destructive-foreground",
      "info",
      "info-foreground",
      "success",
      "success-foreground",
      "warning",
      "warning-foreground",
    ],
  },
  {
    title: "Borders & inputs",
    tokens: ["border", "input"],
  },
  {
    title: "Scrollbars",
    tokens: [
      "scrollbar-thumb",
      "scrollbar-thumb-hover",
      "scrollbar-thumb-thin",
      "scrollbar-thumb-thin-hover",
    ],
  },
  {
    title: "Misc",
    tokens: ["noise-opacity", "radius"],
  },
];

const KNOWN_TOKEN_SET = new Set<string>(THEME_TOKEN_NAMES);

export function setTokenValue(
  theme: ThemeDefinition,
  variant: ThemeVariant,
  token: ThemeTokenName,
  value: string,
): ThemeDefinition {
  const current: ThemeTokens = { ...theme[variant] };
  if (value.length === 0) delete current[token];
  else current[token] = value;
  if (variant === "light") return { ...theme, light: current };
  return { ...theme, dark: current };
}

export function setThemeName(theme: ThemeDefinition, name: string): ThemeDefinition {
  return { ...theme, name };
}

export function setThemeDescription(theme: ThemeDefinition, description: string): ThemeDefinition {
  const next: ThemeDefinition = { ...theme };
  if (description.length === 0) delete next.description;
  else next.description = description;
  return next;
}

export type ThemeEditorProps = {
  source: ThemeDefinition;
  draft: ThemeDefinition;
  onDraftChange: (next: ThemeDefinition) => void;
  onSave: () => void;
  onCancel: () => void;
  resolvedVariant: ThemeVariant;
};

export function ThemeEditor({
  source,
  draft,
  onDraftChange,
  onSave,
  onCancel,
  resolvedVariant,
}: ThemeEditorProps) {
  const [mode, setMode] = useState<Mode>("form");
  const [variant, setVariant] = useState<ThemeVariant>(resolvedVariant);
  const [jsonText, setJsonText] = useState(() => JSON.stringify(draft, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);

  const dirty = useMemo(() => JSON.stringify(source) !== JSON.stringify(draft), [source, draft]);

  useEffect(() => {
    previewTheme(draft);
  }, [draft, resolvedVariant]);

  useEffect(() => {
    return () => {
      restoreActiveThemes();
    };
  }, [source]);

  useEffect(() => {
    if (mode === "form") setJsonText(JSON.stringify(draft, null, 2));
  }, [draft, mode]);

  const handleNameChange = (value: string) => {
    onDraftChange(setThemeName(draft, value));
  };

  const handleDescriptionChange = (value: string) => {
    onDraftChange(setThemeDescription(draft, value));
  };

  const handleTokenChange = (token: ThemeTokenName, value: string) => {
    onDraftChange(setTokenValue(draft, variant, token, value));
  };

  const handleJsonChange = (value: string) => {
    setJsonText(value);
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : "Invalid JSON");
      return;
    }
    if (!isValidTheme(parsed)) {
      setJsonError("Invalid theme schema. Need string id/name and string-only light/dark tokens.");
      return;
    }
    setJsonError(null);
    onDraftChange(parsed);
  };

  const handleCancel = () => {
    if (dirty) {
      setDiscardOpen(true);
      return;
    }
    onCancel();
  };

  const variantTokens: ThemeTokens = (variant === "dark" ? draft.dark : draft.light) ?? {};
  const unknownTokenEntries = Object.entries(variantTokens).filter(
    ([token]) => !KNOWN_TOKEN_SET.has(token),
  );
  const hasInvalidValue = Object.values(variantTokens).some(
    (value) => typeof value === "string" && value.length > 0 && !isValidColorValue(value),
  );
  const saveDisabled = jsonError !== null || draft.name.trim().length === 0 || hasInvalidValue;

  return (
    <div className="border-t border-border/60 bg-muted/24">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border/60 bg-muted/72 px-4 py-2 backdrop-blur-sm sm:px-5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Editing
        </span>
        <span className="truncate text-sm font-medium text-foreground" title={draft.name}>
          {draft.name || "Untitled"}
        </span>
        {dirty ? (
          <span className="rounded-sm bg-warning/16 px-1.5 py-0.5 text-[10px] font-medium text-warning-foreground">
            Unsaved
          </span>
        ) : null}
        <div className="ms-auto flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={onSave} disabled={saveDisabled}>
            Save
          </Button>
        </div>
      </div>

      <div className="px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ToggleGroup
            value={[mode]}
            variant="outline"
            size="sm"
            onValueChange={(values) => {
              const next = values[0];
              if (next === "form" || next === "json") setMode(next);
            }}
          >
            <Toggle value="form" aria-label="Form editor">
              Form
            </Toggle>
            <Toggle value="json" aria-label="JSON editor">
              JSON
            </Toggle>
          </ToggleGroup>
          <ToggleGroup
            value={[variant]}
            variant="outline"
            size="sm"
            onValueChange={(values) => {
              const next = values[0];
              if (next === "light" || next === "dark") setVariant(next);
            }}
          >
            <Toggle value="light" aria-label="Light variant">
              Light
            </Toggle>
            <Toggle value="dark" aria-label="Dark variant">
              Dark
            </Toggle>
          </ToggleGroup>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-foreground">Name</span>
            <Input
              value={draft.name}
              nativeInput
              onChange={(event) => handleNameChange(event.currentTarget.value)}
              aria-invalid={draft.name.trim().length === 0 || undefined}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-foreground">Description</span>
            <Input
              value={draft.description ?? ""}
              nativeInput
              onChange={(event) => handleDescriptionChange(event.currentTarget.value)}
              placeholder="Optional, shown under the picker."
            />
          </label>
        </div>

        {mode === "form" ? (
          <div className="mt-5 space-y-5">
            {TOKEN_CATEGORIES.map((category) => (
              <div key={category.title} className="space-y-2">
                <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {category.title}
                </h4>
                <div className="grid gap-2 sm:grid-cols-2">
                  {category.tokens.map((token) => {
                    const value = variantTokens[token] ?? "";
                    const invalid = value.length > 0 && !isValidColorValue(value);
                    const overridden = value.length > 0;
                    return (
                      <div
                        key={token}
                        className="flex items-center gap-2 rounded-md border border-border/60 bg-background px-2 py-1.5"
                      >
                        <span
                          className="size-5 shrink-0 rounded-sm border border-border/80"
                          style={{
                            backgroundColor: invalid ? "transparent" : value || "transparent",
                          }}
                          aria-hidden
                        />
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span
                            className={cn(
                              "truncate font-mono text-[11px]",
                              overridden ? "text-foreground" : "text-muted-foreground/70",
                            )}
                            title={`--${token}`}
                          >
                            --{token}
                          </span>
                          <Input
                            value={value}
                            nativeInput
                            unstyled
                            size="sm"
                            className="border-0 bg-transparent p-0 shadow-none focus-within:shadow-none"
                            placeholder="inherit default"
                            aria-invalid={invalid || undefined}
                            onChange={(event) =>
                              handleTokenChange(token, event.currentTarget.value)
                            }
                          />
                        </div>
                        {overridden ? (
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            aria-label={`Reset --${token}`}
                            onClick={() => handleTokenChange(token, "")}
                            className="text-muted-foreground"
                          >
                            <span aria-hidden className="text-[10px]">
                              ×
                            </span>
                          </Button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {unknownTokenEntries.length > 0 ? (
              <p className="text-xs text-warning-foreground">
                {unknownTokenEntries.length} token{unknownTokenEntries.length === 1 ? "" : "s"} not
                in the allow-list will be ignored on save.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="mt-5 space-y-2">
            <Textarea
              value={jsonText}
              size="sm"
              className="font-mono text-xs"
              spellCheck={false}
              rows={18}
              onChange={(event) => handleJsonChange(event.currentTarget.value)}
              aria-invalid={jsonError !== null || undefined}
            />
            {jsonError ? (
              <p className="text-xs text-destructive-foreground">{jsonError}</p>
            ) : (
              <p className="text-xs text-muted-foreground/80">
                Edit the JSON directly. Save is disabled while the schema is invalid.
              </p>
            )}
          </div>
        )}
      </div>

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard your changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved edits to {source.name}. Discarding will revert any token changes you
              made.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Keep editing</AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setDiscardOpen(false);
                onCancel();
              }}
            >
              Discard changes
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}
