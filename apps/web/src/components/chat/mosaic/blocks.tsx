"use client";

// The host's own block set: every Mosaic block drawn through this app's design
// system - t3code's vendored UI kit (shadcn-style on Base UI). The artifact stays
// data; the look is entirely ours.
//
// Contract (see @mosaicjs/react): each block receives
// { node, props, children, value, setValue, events }. Stateful controls get
// value/setValue only when the node carries bind:state; when unbound they fall
// back to their own local state (uncontrolled defaultValue), so a mock stays a
// live mock. Named intents leave through events.<name>().

import type { BlockPropTypes, MosaicNode } from "@mosaicjs/core";
import { defineComponents, type MosaicBlockProps } from "@mosaicjs/react";
import { layoutDiagram } from "@mosaicjs/react";
import { ChevronRight, CircleCheck, Info, Star, TriangleAlert, Upload, X } from "lucide-react";
import { DynamicIcon, type IconName, iconNames } from "lucide-react/dynamic";
import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "~/lib/utils";
import { Alert, AlertDescription } from "../../ui/alert";
import {
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
  Autocomplete as UIAutocomplete,
} from "../../ui/autocomplete";
import { Badge as UIBadge } from "../../ui/badge";
import { Button as UIButton } from "../../ui/button";
import { Card as UICard } from "../../ui/card";
import { Checkbox as UICheckbox } from "../../ui/checkbox";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../../ui/collapsible";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxValue,
} from "../../ui/combobox";
import { Empty as UIEmpty } from "../../ui/empty";
import { FieldLabel, Field as UIField } from "../../ui/field";
import { Input as UIInput } from "../../ui/input";
import { RadioGroup, Radio as UIRadio } from "../../ui/radio-group";
import {
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
  Select as UISelect,
} from "../../ui/select";
import { Separator } from "../../ui/separator";
import { Switch } from "../../ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../ui/table";
import { Textarea } from "../../ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "../../ui/toggle-group";

type PV = MosaicBlockProps["props"][string];

const str = (v: PV | undefined): string => {
  if (v === undefined || v === null) return "";
  // Objects only reach here on a schema mismatch (a cell/option that should be a
  // scalar). Render nothing rather than dumping raw JSON into the UI; validation
  // surfaces the real error to the model.
  if (typeof v === "object") return "";
  return String(v);
};

const num = (v: PV | undefined, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const arr = (v: PV | undefined): PV[] => (Array.isArray(v) ? v : []);
const strs = (v: PV | undefined): string[] => arr(v).map((x) => str(x));

const ALIGN: Record<string, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  baseline: "items-baseline",
  stretch: "items-stretch",
};

const JUSTIFY: Record<string, string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between",
};

// Small muted field-label used by composite controls that cannot own a single
// <label htmlFor>. Single-input controls associate with a real <label> instead.
const LABEL = "font-medium text-muted-foreground text-xs";

// tone -> text color (Text, Timeline dot, Stat)
const TONE_TEXT: Record<string, string> = {
  ok: "text-success-foreground",
  warn: "text-warning-foreground",
  bad: "text-destructive-foreground",
  subtle: "text-muted-foreground",
  primary: "text-primary",
};

// tone -> ui/badge variant (tinted background, *-foreground text)
const BADGE_VARIANT: Record<string, "default" | "secondary" | "success" | "warning" | "error"> = {
  ok: "success",
  warn: "warning",
  bad: "error",
  primary: "default",
  subtle: "secondary",
};

// Mosaic Button variant (an intent hierarchy) -> ui/button variant. `subtle` is
// the inline row action, drawn with the ghost treatment.
const BUTTON_VARIANT: Record<string, "default" | "secondary" | "destructive" | "ghost"> = {
  primary: "default",
  secondary: "secondary",
  subtle: "ghost",
  danger: "destructive",
};

// tone -> ui/alert variant + description text color
const CALLOUT_VARIANT: Record<string, "default" | "error" | "info" | "success" | "warning"> = {
  ok: "success",
  warn: "warning",
  bad: "error",
  primary: "info",
};
const CALLOUT_DESC: Record<string, string> = {
  success: "text-success-foreground",
  warning: "text-warning-foreground",
  error: "text-destructive-foreground",
  info: "text-foreground",
  default: "text-foreground",
};

// --- icons ----------------------------------------------------------------------
// Mosaic's icon standard is Lucide (lucide.dev): every `name` / `icon` prop is a
// Lucide icon name in kebab-case ("wallet", "circle-check", "sunrise").
// DynamicIcon code-splits each icon, so referencing a name costs nothing until
// it renders. A handful of common synonyms are aliased to the canonical name;
// an unrecognized name renders nothing rather than breaking the artifact.

const ICON_NAMES = new Set<string>(iconNames);

const ICON_ALIAS: Record<string, string> = {
  warning: "triangle-alert",
  alert: "triangle-alert",
  error: "circle-x",
  success: "circle-check",
  done: "check",
  tick: "check",
  cross: "x",
  close: "x",
  trash: "trash-2",
  delete: "trash-2",
  edit: "pencil",
  gear: "settings",
  idea: "lightbulb",
  money: "wallet",
  email: "mail",
  time: "clock",
  flight: "plane",
  warn: "triangle-alert",
};

function resolveIconName(raw: string): IconName | null {
  const kebab = raw.trim().toLowerCase().replace(/[\s_]+/g, "-");
  const name = ICON_ALIAS[kebab] ?? kebab;
  return ICON_NAMES.has(name) ? (name as IconName) : null;
}

/** Render a Lucide icon by name. Suspense-wrapped (DynamicIcon lazy-loads the
 *  glyph); an unknown name renders an empty slot so layout never shifts. */
function MosaicIcon({ name, className }: { name: string; className?: string }): React.ReactNode {
  const resolved = resolveIconName(name);
  if (!resolved) return null;
  return (
    <React.Suspense fallback={<span className={cn("inline-block size-4 shrink-0", className)} />}>
      <DynamicIcon name={resolved} className={cn("size-4 shrink-0", className)} aria-hidden="true" />
    </React.Suspense>
  );
}

function Icon({ props }: MosaicBlockProps<BlockPropTypes["Icon"]>) {
  if (!props.name) return null;
  return <MosaicIcon name={props.name} className={cn(TONE_TEXT[props.tone ?? ""])} />;
}

// --- vertical rhythm -------------------------------------------------------------
// Mosaic 0.7 removed every spacing prop: the host owns density. A single flat gap
// flattens composed hierarchy, so vertical flows (Stack, Card, Callout, List) space
// each child by what it and its predecessor ARE - spacing derives from adjacent
// structure because the format carries none. `node.children` aligns index-for-index
// with the rendered `children`, so the adjacent-type info is free. `flowKind`
// classifies a node and `rhythm` turns an adjacent pair into the top-margin that
// reads as the right break. This table is the single home of all spacing opinion.

type FlowKind =
  | "heading"
  | "caption"
  | "label"
  | "text"
  | "badge"
  | "card"
  | "callout"
  | "table"
  | "controlRow"
  | "control"
  | "divider"
  | "block";

const CONTROL_TYPES = new Set([
  "Button",
  "Input",
  "Select",
  "MultiSelect",
  "Autocomplete",
  "Checkbox",
  "Radio",
  "Toggle",
  "Slider",
  "Field",
  "TagInput",
  "DatePicker",
  "ColorPicker",
  "SegmentedControl",
  "Rating",
  "FilePicker",
]);

const SECTION_KINDS = new Set<FlowKind>(["card", "callout", "table"]);

function isButtonRow(node: MosaicNode): boolean {
  if (node.type !== "Stack" || node.props?.direction !== "horizontal") return false;
  const kids = node.children ?? [];
  return kids.length > 0 && kids.every((c) => c.type === "Button");
}

function flowKind(node: MosaicNode): FlowKind {
  switch (node.type) {
    case "Heading":
      return "heading";
    case "Text": {
      const v = node.props?.variant;
      return v === "caption" ? "caption" : v === "label" ? "label" : "text";
    }
    case "Badge":
    case "Tag":
      return "badge";
    case "Card":
      return "card";
    case "Callout":
      return "callout";
    case "DataTable":
      return "table";
    case "Divider":
      return "divider";
    case "Stack":
      return isButtonRow(node) ? "controlRow" : "block";
    default:
      return CONTROL_TYPES.has(node.type) ? "control" : "block";
  }
}

/** The mt-* class that spaces `curr` under `prev` in a vertical flow. No prev (the
 *  first child) never gets a margin. */
function rhythm(prev: FlowKind | undefined, curr: FlowKind): string {
  if (prev === undefined) return "";
  if (curr === "label") return "mt-3"; // section break before a micro-label
  if (prev === "label") return "mt-1.5"; // tight tie to what the label introduces
  if (prev === "heading" && (curr === "caption" || curr === "text")) return "mt-0.5";
  if (prev === "badge" && curr === "badge") return "mt-1.5"; // a tight status stack
  if (prev === "card" && curr === "card") return "mt-2"; // grouped action rows
  if ((SECTION_KINDS.has(prev) || SECTION_KINDS.has(curr)) && prev !== curr) return "mt-3";
  if (prev === "text" && curr === "controlRow") return "mt-2.5"; // message, then buttons
  return "mt-2";
}

const childKey = (child: React.ReactNode, i: number): string =>
  React.isValidElement(child) && child.key != null ? child.key : `flow-${i}`;

/** Renders a vertical flow: each child is spaced from its predecessor by rhythm().
 *  `node.children[i]` classifies the rendered `children[i]`. */
function Flow({
  node,
  children,
  className,
}: {
  node: MosaicNode;
  children: React.ReactNode[];
  className?: string;
}): React.ReactNode {
  const kids = node.children ?? [];
  let prev: FlowKind | undefined;
  const rows = children.map((child, i) => {
    const source = kids[i];
    const curr = source ? flowKind(source) : "block";
    const mt = rhythm(prev, curr);
    prev = curr;
    return (
      <div key={childKey(child, i)} className={cn("min-w-0", mt)}>
        {child}
      </div>
    );
  });
  return <div className={className}>{rows}</div>;
}

// A header cluster pairs a leading Icon with a multi-line block (a Stack that owns
// a Heading). The icon should ride the first line, not float centered against the
// whole block, so the row aligns to the top with a small optical drop on the icon.
function containsHeading(node: MosaicNode): boolean {
  return node.type === "Heading" || (node.children ?? []).some(containsHeading);
}
function pairsIconWithHeading(kids: MosaicNode[]): boolean {
  return (
    kids.some((c) => c.type === "Icon") &&
    kids.some((c) => c.type !== "Icon" && containsHeading(c))
  );
}

// --- layout ---------------------------------------------------------------------

function Stack({ node, props, children }: MosaicBlockProps<BlockPropTypes["Stack"]>) {
  if (props.direction !== "horizontal") {
    return (
      <Flow
        node={node}
        className={cn("flex min-w-0 flex-col", ALIGN[props.align ?? ""], JUSTIFY[props.justify ?? ""])}
      >
        {children}
      </Flow>
    );
  }
  const kids = node.children ?? [];
  const allButtons = kids.length > 0 && kids.every((c) => c.type === "Button");
  const iconLede = pairsIconWithHeading(kids);
  return (
    <div
      className={cn(
        "flex min-w-0 flex-row flex-wrap",
        allButtons ? "gap-1.5" : "gap-2",
        iconLede ? "items-start" : (ALIGN[props.align ?? ""] ?? "items-center"),
        JUSTIFY[props.justify ?? ""],
      )}
    >
      {iconLede
        ? children.map((child, i) =>
            kids[i]?.type === "Icon" ? (
              <span key={childKey(child, i)} className="mt-0.5 flex shrink-0">
                {child}
              </span>
            ) : (
              child
            ),
          )
        : children}
    </div>
  );
}

function Grid({ props, children }: MosaicBlockProps<BlockPropTypes["Grid"]>) {
  // Children without explicit spans divide the grid equally, so a 12-col Grid
  // with three Stats renders three real columns (never twelve thin ones).
  const count = Math.max(React.Children.count(children), 1);
  const cols = Math.min(count, props.cols ?? 12);
  return (
    <div
      className="grid items-stretch gap-2"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {children}
    </div>
  );
}

function Box({ children }: MosaicBlockProps) {
  return <div className="min-w-0">{children}</div>;
}

// tone -> tinted surface (the inset status panel: a green "handled" section, an
// amber "needs attention" strip). Untinted cards keep the default surface.
const CARD_TONE: Record<string, string> = {
  ok: "border-success/25 bg-success/8",
  warn: "border-warning/25 bg-warning/8",
  bad: "border-destructive/25 bg-destructive/8",
  primary: "border-primary/25 bg-primary/8",
  subtle: "border-transparent bg-muted/50",
};

function Card({ node, props, children, events }: MosaicBlockProps<BlockPropTypes["Card"]>) {
  const clickable = Boolean(events.click);
  return (
    <UICard
      className={cn(
        // Tighter than a standalone card: an artifact is embedded in a chat
        // message, so it reads as a compact surface, not a full page panel.
        "rounded-xl p-3",
        CARD_TONE[props.tone ?? ""],
        clickable && "cursor-pointer transition-colors hover:border-ring/40",
      )}
      onClick={events.click}
      onKeyUp={clickable ? (e) => e.key === "Enter" && events.click?.() : undefined}
      tabIndex={clickable ? 0 : undefined}
    >
      <Flow node={node}>{children}</Flow>
    </UICard>
  );
}

function Divider() {
  return <Separator />;
}

// --- content --------------------------------------------------------------------

function Heading({ props, children }: MosaicBlockProps<BlockPropTypes["Heading"]>) {
  const level = Math.min(Math.max(props.level ?? 2, 1), 6);
  const Tag = `h${level}` as "h2";
  const size =
    level === 1 ? "text-xl" : level === 2 ? "text-lg" : level === 3 ? "text-base" : "text-sm";
  return (
    <Tag className={cn(size, "text-balance font-semibold text-foreground tracking-tight")}>
      {children}
    </Tag>
  );
}

// variant is the semantic type ramp: body is prose; label is a section
// micro-label; caption is secondary supporting text. The host owns the scale.
const TEXT_VARIANT: Record<string, string> = {
  label: "text-[11px] font-medium uppercase leading-snug tracking-[0.08em]",
  caption: "text-xs text-muted-foreground leading-snug",
};

function Text({ props, children }: MosaicBlockProps<BlockPropTypes["Text"]>) {
  return (
    <p
      className={cn(
        "leading-relaxed",
        TONE_TEXT[props.tone ?? ""] ?? "text-foreground",
        TEXT_VARIANT[props.variant ?? "body"],
      )}
    >
      {children}
    </p>
  );
}

function Badge({ props, children }: MosaicBlockProps<BlockPropTypes["Badge"]>) {
  return (
    <UIBadge variant={BADGE_VARIANT[props.tone ?? ""] ?? "secondary"} className="gap-1 rounded-full">
      {props.icon ? <MosaicIcon name={props.icon} className="size-3" /> : null}
      {children}
    </UIBadge>
  );
}

function Avatar({ props }: MosaicBlockProps) {
  const name = str(props.name) || str(props.initials);
  const initials = name
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/15 font-medium text-primary text-sm">
      {initials}
    </span>
  );
}

function Callout({ node, props, children }: MosaicBlockProps<BlockPropTypes["Callout"]>) {
  const variant = CALLOUT_VARIANT[props.tone ?? ""] ?? "default";
  const custom = props.icon;
  const FallbackIcon =
    variant === "success"
      ? CircleCheck
      : variant === "warning" || variant === "error"
        ? TriangleAlert
        : Info;
  return (
    // [&>div]:items-start tops the icon on the first text line instead of centering
    // it against a multi-line body (message plus a trailing button row).
    <Alert variant={variant} className="[&>div]:items-start">
      {custom ? <MosaicIcon name={custom} /> : <FallbackIcon />}
      <AlertDescription className={cn("leading-relaxed", CALLOUT_DESC[variant])}>
        <Flow node={node}>{children}</Flow>
      </AlertDescription>
    </Alert>
  );
}

function Link({ props, children }: MosaicBlockProps) {
  return (
    <a
      href={str(props.href)}
      className="text-primary underline-offset-4 hover:underline"
      target="_blank"
      rel="noopener noreferrer"
    >
      {React.Children.count(children) > 0 ? children : str(props.href)}
    </a>
  );
}

// Code: a bare command / snippet block, given the app's .chat-markdown-codeblock
// treatment (scoped under .chat-markdown).
function Code({ props, children }: MosaicBlockProps) {
  return (
    <div className="chat-markdown">
      <div className="chat-markdown-codeblock" data-wrap="true">
        <pre>
          <code className="font-mono text-xs">
            {str(props.value)}
            {children}
          </code>
        </pre>
      </div>
    </div>
  );
}

/** Flatten rendered children back to their source text, so `<Markdown>` can
 *  render markdown passed as children (`<Markdown>**bold**</Markdown>`), not
 *  just via a `value` prop. */
function nodeText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (React.isValidElement(node)) {
    return nodeText((node.props as { children?: React.ReactNode }).children);
  }
  return "";
}

function Markdown({ props, children }: MosaicBlockProps) {
  const src = str(props.value) || nodeText(children);
  return (
    <div className="chat-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{src}</ReactMarkdown>
    </div>
  );
}

// --- controls ---------------------------------------------------------------------

function Button({ props, children, events }: MosaicBlockProps<BlockPropTypes["Button"]>) {
  return (
    <UIButton
      variant={BUTTON_VARIANT[props.variant ?? ""] ?? "secondary"}
      size="sm"
      onClick={events.click}
    >
      {props.icon ? <MosaicIcon name={props.icon} /> : null}
      {children}
    </UIButton>
  );
}

function Input({ props, value, setValue }: MosaicBlockProps) {
  const label = str(props.label);
  const id = React.useId();
  const current = str((value as PV) ?? props.value);
  const placeholder = str(props.placeholder) || undefined;

  if (props.multiline) {
    // Textarea uses Base UI Field.Control, so it must live inside a Field.
    return (
      <UIField>
        {label ? <FieldLabel>{label}</FieldLabel> : null}
        <Textarea
          placeholder={placeholder}
          {...(setValue
            ? { value: current, onChange: (e) => setValue(e.target.value) }
            : { defaultValue: current })}
        />
      </UIField>
    );
  }

  const input = (
    <UIInput
      id={id}
      type={str(props.type) || "text"}
      size="sm"
      placeholder={placeholder}
      {...(setValue
        ? { value: current, onValueChange: (v: string) => setValue(v) }
        : { defaultValue: current })}
    />
  );
  return label ? (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      {input}
    </div>
  ) : (
    input
  );
}

function Select({ props, value, setValue }: MosaicBlockProps) {
  const options = strs(props.options);
  const label = str(props.label);
  const current = str((value as PV) ?? props.value);
  const el = (
    <UISelect
      {...(setValue
        ? { value: current, onValueChange: (v: unknown) => setValue(str(v as PV)) }
        : { defaultValue: current || undefined })}
    >
      <SelectTrigger size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectPopup>
    </UISelect>
  );
  return label ? (
    <div className="flex min-w-0 flex-col gap-2">
      <span className={LABEL}>{label}</span>
      {el}
    </div>
  ) : (
    el
  );
}

function Checkbox({ props, value, setValue }: MosaicBlockProps) {
  const id = React.useId();
  const checked = Boolean(value ?? props.checked ?? props.value);
  return (
    <div className="flex items-start gap-2.5 text-sm leading-snug">
      <UICheckbox
        id={id}
        className="mt-0.5"
        {...(setValue
          ? { checked, onCheckedChange: (c: boolean) => setValue(c) }
          : { defaultChecked: Boolean(props.checked ?? props.value) })}
      />
      <label htmlFor={id} className="cursor-pointer">
        {str(props.label)}
      </label>
    </div>
  );
}

function Radio({ props, value, setValue }: MosaicBlockProps) {
  const options = strs(props.options);
  const label = str(props.label);
  const base = React.useId();
  const current = str((value as PV) ?? props.value);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {label ? <span className={LABEL}>{label}</span> : null}
      <RadioGroup
        className="gap-2"
        {...(setValue
          ? { value: current, onValueChange: (v: unknown) => setValue(str(v as PV)) }
          : { defaultValue: current || undefined })}
      >
        {options.map((o, i) => {
          const id = `${base}-${i}`;
          return (
            <div key={o} className="flex items-center gap-2.5 text-sm">
              <UIRadio id={id} value={o} />
              <label htmlFor={id} className="cursor-pointer">
                {o}
              </label>
            </div>
          );
        })}
      </RadioGroup>
    </div>
  );
}

function Toggle({ props, value, setValue }: MosaicBlockProps) {
  const id = React.useId();
  const on = Boolean(value ?? props.checked ?? props.value);
  return (
    <div className="flex items-center gap-2.5 text-sm">
      <Switch
        id={id}
        {...(setValue
          ? { checked: on, onCheckedChange: (c: boolean) => setValue(c) }
          : { defaultChecked: Boolean(props.checked ?? props.value) })}
      />
      <label htmlFor={id} className="cursor-pointer">
        {str(props.label)}
      </label>
    </div>
  );
}

// t3code has no ui/slider yet, so this is a token-styled native range input.
// accent-primary paints the track fill from the primary token.
function Slider({ props, value, setValue }: MosaicBlockProps) {
  const label = str(props.label);
  const bound = Boolean(setValue);
  const [local, setLocal] = React.useState<number>(() => num(props.value));
  const v = bound ? num(value as PV) : local;
  const write = (n: number) => (setValue ? setValue(n) : setLocal(n));
  const slider = (
    <div className="flex items-center gap-2.5">
      <input
        type="range"
        min={num(props.min)}
        max={num(props.max, 100)}
        step={num(props.step, 1)}
        value={v}
        onChange={(e) => write(Number(e.target.value))}
        className="h-1.5 w-full min-w-32 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-primary outline-none"
      />
      <span className="w-10 shrink-0 text-right font-mono text-muted-foreground text-xs">{v}</span>
    </div>
  );
  return label ? (
    <div className="flex min-w-0 flex-col gap-2">
      <span className={LABEL}>{label}</span>
      {slider}
    </div>
  ) : (
    slider
  );
}

function Field({ props, children }: MosaicBlockProps) {
  const help = str(props.help);
  const label = str(props.label);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {label ? <span className={LABEL}>{label}</span> : null}
      {children}
      {help ? <span className="text-muted-foreground text-xs">{help}</span> : null}
    </div>
  );
}

function MultiSelect({ props, value, setValue }: MosaicBlockProps) {
  const options = strs(props.options);
  const label = str(props.label);
  const selected = strs((value as PV) ?? props.value);
  const el = (
    <Combobox
      items={options}
      multiple
      {...(setValue
        ? {
            value: selected,
            onValueChange: (v: unknown) =>
              setValue((Array.isArray(v) ? v : []).map((x) => str(x as PV))),
          }
        : { defaultValue: selected })}
    >
      <ComboboxChips>
        <ComboboxValue>
          {(vals: unknown) =>
            (Array.isArray(vals) ? vals : []).map((v) => (
              <ComboboxChip key={str(v as PV)}>{str(v as PV)}</ComboboxChip>
            ))
          }
        </ComboboxValue>
        <ComboboxChipsInput placeholder={str(props.placeholder) || "Select..."} />
      </ComboboxChips>
      <ComboboxPopup>
        <ComboboxEmpty>No options.</ComboboxEmpty>
        <ComboboxList>
          {(item: unknown) => (
            <ComboboxItem key={str(item as PV)} value={item as string}>
              {str(item as PV)}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
  return label ? (
    <div className="flex min-w-0 flex-col gap-2">
      <span className={LABEL}>{label}</span>
      {el}
    </div>
  ) : (
    el
  );
}

function Autocomplete({ props, value, setValue }: MosaicBlockProps) {
  const options = strs(props.options);
  const label = str(props.label);
  const current = str((value as PV) ?? props.value);
  const el = (
    <UIAutocomplete
      items={options}
      {...(setValue
        ? { value: current, onValueChange: (v: string) => setValue(v) }
        : { defaultValue: current })}
    >
      <AutocompleteInput size="sm" placeholder={str(props.placeholder) || undefined} />
      <AutocompletePopup>
        <AutocompleteEmpty>No matches.</AutocompleteEmpty>
        <AutocompleteList>
          {(item: unknown) => (
            <AutocompleteItem key={str(item as PV)} value={item as string}>
              {str(item as PV)}
            </AutocompleteItem>
          )}
        </AutocompleteList>
      </AutocompletePopup>
    </UIAutocomplete>
  );
  return label ? (
    <div className="flex min-w-0 flex-col gap-2">
      <span className={LABEL}>{label}</span>
      {el}
    </div>
  ) : (
    el
  );
}

function TagInput({ props, value, setValue }: MosaicBlockProps) {
  const label = str(props.label);
  const bound = Boolean(setValue);
  const [local, setLocal] = React.useState<string[]>(() => strs(props.value));
  const tags = bound ? strs(value as PV) : local;
  const write = React.useCallback(
    (next: string[]) => (setValue ? setValue(next) : setLocal(next)),
    [setValue],
  );
  const [draft, setDraft] = React.useState("");
  const commit = () => {
    const tag = draft.trim();
    if (tag && !tags.includes(tag)) write([...tags, tag]);
    setDraft("");
  };
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {label ? <span className={LABEL}>{label}</span> : null}
      <div className="flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-lg border border-input bg-background px-2.5 py-1.5 shadow-xs/5 transition-shadow focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/24 dark:bg-input/32">
        {tags.map((tag) => (
          <UIBadge key={tag} variant="secondary" className="gap-1 pe-1">
            {tag}
            <button
              type="button"
              aria-label={`remove ${tag}`}
              onClick={() => write(tags.filter((x) => x !== tag))}
              className="opacity-70 transition-opacity hover:opacity-100"
            >
              <X className="size-3" />
            </button>
          </UIBadge>
        ))}
        <input
          type="text"
          value={draft}
          placeholder={tags.length === 0 ? str(props.placeholder) || "Add..." : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commit();
            } else if (e.key === "Backspace" && draft === "" && tags.length > 0) {
              write(tags.slice(0, -1));
            }
          }}
          onBlur={commit}
          className="min-w-20 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/72"
        />
      </div>
    </div>
  );
}

function DatePicker({ props, value, setValue }: MosaicBlockProps) {
  const label = str(props.label);
  const id = React.useId();
  const current = str((value as PV) ?? props.value);
  const input = (
    <UIInput
      id={id}
      type="date"
      size="sm"
      className="w-fit"
      {...(setValue
        ? { value: current, onValueChange: (v: string) => setValue(v) }
        : { defaultValue: current })}
    />
  );
  return label ? (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      {input}
    </div>
  ) : (
    input
  );
}

function ColorPicker({ props, value, setValue }: MosaicBlockProps) {
  const label = str(props.label);
  const id = React.useId();
  const current = str((value as PV) ?? props.value) || "#7c7cff";
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {label ? (
        <label htmlFor={id} className={LABEL}>
          {label}
        </label>
      ) : null}
      <div className="flex items-center gap-2.5">
        <input
          id={id}
          type="color"
          className="size-8 cursor-pointer rounded-md border border-input bg-transparent p-0.5"
          {...(setValue
            ? { value: current, onChange: (e) => setValue(e.target.value) }
            : { defaultValue: current })}
        />
        <code className="font-mono text-muted-foreground text-xs">{current}</code>
      </div>
    </div>
  );
}

// --- structure & status ---------------------------------------------------------

function SegmentedControl({ props, value, setValue }: MosaicBlockProps) {
  const options = strs(props.options);
  const current = str((value as PV) ?? props.value);
  return (
    <ToggleGroup
      variant="outline"
      size="sm"
      className="w-fit"
      {...(setValue
        ? {
            value: [current],
            onValueChange: (v: unknown) => {
              const list = Array.isArray(v) ? v : [];
              const last = list[list.length - 1];
              if (last !== undefined) setValue(str(last as PV));
            },
          }
        : { defaultValue: current ? [current] : [] })}
    >
      {options.map((o) => (
        <ToggleGroupItem key={o} value={o}>
          {o}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

// t3code has no ui/tabs yet, so this is a token-styled pill tablist, controlled
// via bind:state or its own local state when unbound.
function Tabs({ props, children, value, setValue }: MosaicBlockProps) {
  const labels = strs(props.items);
  const active = props.active;
  const defaultLabel =
    typeof active === "number" ? (labels[active] ?? labels[0]) : str(active) || labels[0];
  const panels = React.Children.toArray(children);
  const bound = Boolean(setValue);
  const [local, setLocal] = React.useState<string>(defaultLabel ?? "");
  const current = bound ? str(value as PV) || (defaultLabel ?? "") : local;
  const select = (label: string) => (setValue ? setValue(label) : setLocal(label));
  const activeIndex = Math.max(labels.indexOf(current), 0);
  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <div role="tablist" className="flex w-fit gap-1 rounded-lg bg-muted p-1">
        {labels.map((label) => {
          const isActive = label === current;
          return (
            <button
              key={label}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => select(label)}
              className={cn(
                "cursor-pointer whitespace-nowrap rounded-md px-3 py-1 font-medium text-sm outline-none transition-colors",
                isActive
                  ? "bg-background text-foreground shadow-xs/5"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel">{panels[activeIndex] ?? null}</div>
    </div>
  );
}

// t3code has no ui/progress yet, so this is a token-styled track + fill.
function Progress({ props }: MosaicBlockProps) {
  const value = Math.min(Math.max(num(props.value), 0), 100);
  const label = str(props.label);
  return (
    <div className="flex flex-col gap-1.5">
      {label ? <span className="text-muted-foreground text-xs">{label}</span> : null}
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

function Steps({ props }: MosaicBlockProps) {
  const items = strs(props.items);
  const current = num(props.current, -1);
  return (
    <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
      {items.map((item, i) => (
        <li key={item} className="flex items-center gap-1.5">
          {i > 0 ? <span className="text-muted-foreground/50">→</span> : null}
          <span
            className={cn(
              i === current
                ? "font-medium text-foreground"
                : i < current
                  ? "text-foreground/70"
                  : "text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "me-1.5 inline-flex size-5 items-center justify-center rounded-full text-xs",
                i < current
                  ? "bg-success/15 text-success-foreground"
                  : i === current
                    ? "bg-primary/15 text-primary"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {i + 1}
            </span>
            {item}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Empty({ props, children }: MosaicBlockProps) {
  return (
    <UIEmpty className="gap-2 rounded-lg border border-dashed p-6 text-muted-foreground text-sm">
      {str(props.label) || (React.Children.count(children) === 0 ? "Nothing here yet." : null)}
      {children}
    </UIEmpty>
  );
}

// --- data & viz -------------------------------------------------------------------

function Stat({ props }: MosaicBlockProps<BlockPropTypes["Stat"]>) {
  return (
    <div className={cn("min-w-0", TONE_TEXT[props.tone ?? ""])}>
      <div className="whitespace-nowrap font-[650] text-[1.125rem] leading-tight tracking-[-0.02em]">
        {props.value}
      </div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{props.label}</div>
    </div>
  );
}

function DataTable({ props }: MosaicBlockProps) {
  const columns = strs(props.columns);
  const rows = arr(props.rows).map((r) => (Array.isArray(r) ? r.map((c) => str(c)) : [str(r)]));
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((c) => (
              <TableHead
                key={c}
                className="text-[10.5px] text-muted-foreground uppercase tracking-wider"
              >
                {c}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.join("")}>
              {row.map((cell, ci) => (
                <TableCell
                  key={columns[ci] ?? cell}
                  className="whitespace-normal align-top leading-snug"
                >
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Timeline({ props }: MosaicBlockProps) {
  const items = arr(props.items);
  return (
    <ol className="flex flex-col gap-2">
      {items.map((item) => {
        const e = (item && typeof item === "object" && !Array.isArray(item) ? item : {}) as Record<
          string,
          PV
        >;
        const description = str(e.description);
        return (
          <li
            key={`${str(e.date)}-${str(e.title)}`}
            className="flex items-baseline gap-2.5 text-sm"
          >
            <span
              className={cn("text-[0.6rem]", TONE_TEXT[str(e.tone)] ?? "text-muted-foreground/60")}
            >
              ●
            </span>
            <span className="w-14 shrink-0 font-mono text-muted-foreground text-xs">
              {str(e.date)}
            </span>
            <span className="flex min-w-0 flex-col leading-snug">
              <span>{str(e.title)}</span>
              {description ? (
                <span className="text-muted-foreground text-xs">{description}</span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function List({ node, children }: MosaicBlockProps) {
  return (
    <Flow node={node} className="flex min-w-0 flex-col">
      {children}
    </Flow>
  );
}

function Chart({ props }: MosaicBlockProps) {
  // Canonical data shape: [{ label, value }]. Any chart type degrades to labeled
  // magnitude bars - a readable floor when a richer chart is not drawn.
  const data = arr(props.data).map(rec);
  if (data.length === 0) {
    return <p className="text-muted-foreground text-sm">{str(props.alt)}</p>;
  }
  const values = data.map((d) => num(d.value));
  const labels = data.map((d) => str(d.label));
  const max = Math.max(...values, 1);
  return (
    <div role="img" aria-label={str(props.alt)} className="flex flex-col gap-1.5">
      <div className="flex items-end gap-3 border-border border-b">
        {values.map((v, i) => (
          <div
            key={labels[i]}
            className="flex min-w-0 flex-1 flex-col justify-end gap-1.5 text-center"
          >
            <div className="whitespace-nowrap font-mono text-[10px] text-muted-foreground">
              {Number.isInteger(v) ? v : v.toFixed(2)}
            </div>
            <div
              className="rounded-t-sm bg-primary"
              style={{ height: `${Math.max(Math.round((v / max) * 120), 3)}px` }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-3">
        {labels.map((label) => (
          <div
            key={label}
            className="min-w-0 flex-1 truncate text-center font-mono text-[10px] text-muted-foreground"
          >
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

// Diagram: declarative nodes/edges/groups. Geometry comes from @mosaicjs/react's
// exported layoutDiagram (deterministic, dependency-free); the paint is entirely
// this app's - token colors, ui-kit radii. Selection is the standard contract:
// clicking a node writes its id to the bound path (setValue), the background
// writes null, and an authored on:event select escalates through events.select
// like any other named intent.

const DIAGRAM_TONE: Record<string, string> = {
  ok: "var(--success)",
  warn: "var(--warning)",
  bad: "var(--destructive)",
  primary: "var(--primary)",
};
const DIAGRAM_TONE_TEXT: Record<string, string> = {
  ok: "var(--success-foreground)",
  warn: "var(--warning-foreground)",
  bad: "var(--destructive-foreground)",
  primary: "var(--primary)",
};
const DIAGRAM_NODE_STROKE: Record<string, string> = {
  ok: "stroke-success/45",
  warn: "stroke-warning/55",
  bad: "stroke-destructive/45",
  primary: "stroke-primary/45",
};

const mixt = (color: string, pct: number): string =>
  `color-mix(in srgb, ${color} ${pct}%, transparent)`;

const rec = (v: PV | undefined): Record<string, PV> =>
  v !== null && v !== undefined && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, PV>)
    : {};

// A horizontal flow wider than this scales below readability in the chat
// column, so an unspecified direction flips to vertical instead of shrinking.
const DIAGRAM_MAX_HORIZONTAL_WIDTH = 680;

function Diagram({ props, value, setValue, events }: MosaicBlockProps) {
  const markerBase = `dg-arrow-${React.useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  let layout = layoutDiagram({
    direction: props.direction,
    nodes: props.nodes,
    edges: props.edges,
    groups: props.groups,
  });
  if (props.direction === undefined && layout.width > DIAGRAM_MAX_HORIZONTAL_WIDTH) {
    layout = layoutDiagram({
      direction: "down",
      nodes: props.nodes,
      edges: props.edges,
      groups: props.groups,
    });
  }

  const nodeMeta = new Map<string, Record<string, PV>>();
  for (const n of arr(props.nodes)) {
    const m = rec(n);
    const id = str(m.id);
    if (id && !nodeMeta.has(id)) nodeMeta.set(id, m);
  }
  const groupMeta = new Map<string, Record<string, PV>>();
  for (const g of arr(props.groups)) groupMeta.set(str(rec(g).id), rec(g));
  // layoutDiagram drops edges with unknown endpoints; mirror its filter so the
  // authored metadata (tone, dashed, label) zips 1:1 with layout.edges.
  const anchored = new Set([...layout.nodes, ...layout.groups].map((r) => r.id));
  const edgeMeta = arr(props.edges)
    .map(rec)
    .filter((e) => anchored.has(str(e.from)) && anchored.has(str(e.to)));

  const interactive = Boolean(setValue) || Boolean(events.select);
  const selected = value === null || value === undefined ? null : str(value as PV);
  const pick = (id: string) => {
    setValue?.(id);
    events.select?.();
  };

  // One arrowhead marker per distinct edge color, collected while edges render.
  const markerColors: string[] = [];
  const markerId = (color: string): string => {
    let i = markerColors.indexOf(color);
    if (i === -1) i = markerColors.push(color) - 1;
    return `${markerBase}-${i}`;
  };

  const hulls = layout.groups.map((r) => {
    const meta = groupMeta.get(r.id) ?? {};
    const tone = DIAGRAM_TONE[str(meta.tone)];
    return (
      <g key={`group-${r.id}`}>
        <rect
          x={r.x}
          y={r.y}
          width={r.w}
          height={r.h}
          rx={12}
          strokeDasharray="3 4"
          style={{
            fill: mixt(tone ?? "var(--foreground)", 3),
            stroke: mixt(tone ?? "var(--foreground)", 14),
          }}
        />
        <text
          x={r.x + 12}
          y={r.y + 16}
          fontSize={9.5}
          letterSpacing="0.08em"
          className="fill-muted-foreground font-medium uppercase"
          style={tone ? { fill: DIAGRAM_TONE_TEXT[str(meta.tone)] } : undefined}
        >
          {str(meta.label) || r.id}
        </text>
      </g>
    );
  });

  const edgeEls = layout.edges.map((edge, i) => {
    const meta = edgeMeta[i] ?? {};
    const tone = DIAGRAM_TONE[str(meta.tone)];
    const color = tone ? mixt(tone, 65) : mixt("var(--muted-foreground)", 50);
    const [p0, p1, p2] = edge.points;
    if (!p0 || !p1) return null;
    const d = p2
      ? `M ${p0.x} ${p0.y} Q ${p1.x} ${p1.y} ${p2.x} ${p2.y}`
      : `M ${p0.x} ${p0.y} L ${p1.x} ${p1.y}`;
    const mid = p2
      ? { x: 0.25 * p0.x + 0.5 * p1.x + 0.25 * p2.x, y: 0.25 * p0.y + 0.5 * p1.y + 0.25 * p2.y }
      : { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
    const label = str(meta.label);
    return (
      <g key={`edge-${edge.from}-${edge.to}`}>
        <path
          d={d}
          fill="none"
          strokeWidth={1.25}
          strokeDasharray={meta.dashed === true ? "5 4" : undefined}
          markerEnd={`url(#${markerId(color)})`}
          markerStart={meta.bidirectional === true ? `url(#${markerId(color)})` : undefined}
          style={{ stroke: color }}
        />
        {label ? (
          <text
            x={mid.x}
            y={mid.y - 5}
            textAnchor="middle"
            fontSize={9.5}
            className="fill-muted-foreground font-mono"
          >
            {label}
          </text>
        ) : null}
      </g>
    );
  });

  const nodeEls = layout.nodes.map((r) => {
    const meta = nodeMeta.get(r.id) ?? {};
    const toneKey = str(meta.tone);
    const tone = DIAGRAM_TONE[toneKey];
    const isSelected = selected !== null && selected === r.id;
    const label = str(meta.label) || r.id;
    const sublabel = str(meta.sublabel);
    const kind = str(meta.kind);
    const badge = str(meta.badge);
    const badgeW = Math.round(badge.length * 6.2 + 14);
    return (
      <g
        key={r.id}
        data-node-id={r.id}
        className={interactive ? "group/node cursor-pointer" : undefined}
        onClick={
          interactive
            ? (e) => {
                e.stopPropagation();
                pick(r.id);
              }
            : undefined
        }
      >
        {isSelected ? (
          <rect
            x={r.x - 2.5}
            y={r.y - 2.5}
            width={r.w + 5}
            height={r.h + 5}
            rx={11}
            fill="none"
            strokeWidth={3}
            style={{ stroke: mixt("var(--ring)", 24) }}
          />
        ) : null}
        <rect
          x={r.x}
          y={r.y}
          width={r.w}
          height={r.h}
          rx={9}
          strokeWidth={isSelected ? 1.6 : 1}
          className={cn(
            isSelected ? "stroke-primary" : (DIAGRAM_NODE_STROKE[toneKey] ?? "stroke-border"),
            interactive && !isSelected && "transition-[stroke] group-hover/node:stroke-ring/60",
          )}
          style={{
            fill: tone
              ? `color-mix(in srgb, ${tone} 9%, var(--card))`
              : "color-mix(in srgb, var(--foreground) 4%, var(--card))",
          }}
        />
        <text
          x={r.x + 13}
          y={r.y + (sublabel || kind ? r.h / 2 - 6 : r.h / 2)}
          dominantBaseline="central"
          fontSize={12}
          className={cn("fill-foreground font-medium", kind === "code" && "font-mono")}
        >
          {label}
        </text>
        {sublabel ? (
          <text
            x={r.x + 13}
            y={r.y + r.h / 2 + 9}
            dominantBaseline="central"
            fontSize={10}
            className="fill-muted-foreground"
          >
            {sublabel}
          </text>
        ) : kind ? (
          <text
            x={r.x + 13}
            y={r.y + r.h / 2 + 9}
            dominantBaseline="central"
            fontSize={8}
            letterSpacing="0.08em"
            className="fill-muted-foreground uppercase"
          >
            {kind}
          </text>
        ) : null}
        {badge ? (
          <g>
            <rect
              x={r.x + r.w - badgeW - 6}
              y={r.y - 9}
              width={badgeW}
              height={17}
              rx={8.5}
              style={{
                fill: "var(--card)",
                stroke: tone ? mixt(tone, 45) : "var(--border)",
              }}
            />
            <text
              x={r.x + r.w - 6 - badgeW / 2}
              y={r.y - 0.5}
              textAnchor="middle"
              fontSize={9}
              className="font-mono"
              style={{ fill: DIAGRAM_TONE_TEXT[toneKey] ?? "var(--muted-foreground)" }}
            >
              {badge}
            </text>
          </g>
        ) : null}
      </g>
    );
  });

  return (
    // Natural size inside a scroll container: a diagram slightly wider than
    // the column pans instead of scaling its labels below readability.
    <div className="max-w-full overflow-x-auto">
      <svg
        role="img"
        aria-label={str(props.alt)}
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="block"
      >
        <defs>
          {markerColors.map((color, i) => (
            <marker
              key={color}
              id={`${markerBase}-${i}`}
              viewBox="0 0 10 10"
              refX={9}
              refY={5}
              markerWidth={7}
              markerHeight={7}
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" style={{ fill: color }} />
            </marker>
          ))}
        </defs>
        <rect
          x={0}
          y={0}
          width={layout.width}
          height={layout.height}
          fill="transparent"
          onClick={interactive && setValue ? () => setValue(null) : undefined}
        />
        {hulls}
        {edgeEls}
        {nodeEls}
      </svg>
    </div>
  );
}

// --- media ----------------------------------------------------------------------

/** Shared graceful surface for a block whose real render needs a source or a
 *  dependency we deliberately keep out of the artifact renderer (a missing image,
 *  a Vega spec, a Canvas SVG). Shows the alt so meaning never disappears. */
function BlockPlaceholder({
  icon,
  label,
  hint,
}: {
  icon: string;
  label: string;
  hint?: string;
}): React.ReactNode {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed p-6 text-center text-muted-foreground">
      <MosaicIcon name={icon} className="size-5 opacity-70" />
      {label ? <span className="text-sm">{label}</span> : null}
      {hint ? <span className="text-[11px] opacity-70">{hint}</span> : null}
    </div>
  );
}

function ImageBlock({ props }: MosaicBlockProps<BlockPropTypes["Image"]>) {
  const src = str(props.src);
  const alt = str(props.alt);
  if (!src) return <BlockPlaceholder icon="image" label={alt} />;
  // A model-authored URL rendered as data, not markup: a plain <img> keeps the
  // artifact renderer free of any framework image pipeline.
  return (
    <img src={src} alt={alt} loading="lazy" className="max-h-80 w-full rounded-xl border object-contain" />
  );
}

function VideoBlock({ props }: MosaicBlockProps<BlockPropTypes["Video"]>) {
  const src = str(props.src);
  const alt = str(props.alt);
  if (!src) return <BlockPlaceholder icon="film" label={alt} />;
  return (
    <video src={src} controls aria-label={alt || undefined} className="max-h-96 w-full rounded-xl border">
      <track kind="captions" />
    </video>
  );
}

function AudioBlock({ props }: MosaicBlockProps<BlockPropTypes["Audio"]>) {
  const src = str(props.src);
  const alt = str(props.alt);
  if (!src) return <BlockPlaceholder icon="volume-2" label={alt} />;
  return <audio src={src} controls aria-label={alt || undefined} className="w-full" />;
}

function Carousel({ children }: MosaicBlockProps) {
  const slides = React.Children.toArray(children);
  if (slides.length === 0) return null;
  return (
    <div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2">
      {slides.map((slide, i) => (
        <div
          key={childKey(slide, i)}
          className="min-w-0 shrink-0 basis-[86%] snap-start sm:basis-[46%]"
        >
          {slide}
        </div>
      ))}
    </div>
  );
}

// --- controls -------------------------------------------------------------------

function Rating({ props, value, setValue }: MosaicBlockProps) {
  const max = Math.min(Math.max(num(props.max, 5), 1), 10);
  const label = str(props.label);
  const bound = Boolean(setValue);
  const [local, setLocal] = React.useState(0);
  const current = bound ? num(value as PV) : local;
  const set = (n: number) => (setValue ? setValue(n) : setLocal(n));
  return (
    <div className="flex flex-col gap-1.5">
      {label ? <span className={LABEL}>{label}</span> : null}
      <div className="flex items-center gap-0.5">
        {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => set(n)}
            aria-label={`Rate ${n} of ${max}`}
            className="cursor-pointer text-muted-foreground/40 transition-colors hover:text-amber-500"
          >
            <Star className={cn("size-5", n <= current && "fill-amber-500 text-amber-500")} />
          </button>
        ))}
      </div>
    </div>
  );
}

function FilePicker({ props, value, setValue }: MosaicBlockProps) {
  const label = str(props.label);
  const current = str(value as PV);
  return (
    <div className="flex flex-col gap-1.5">
      {label ? <span className={LABEL}>{label}</span> : null}
      <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-muted-foreground text-sm transition-colors hover:border-ring/40 hover:text-foreground">
        <Upload className="size-4 shrink-0" />
        <span className="truncate">{current || "Choose a file"}</span>
        <input
          type="file"
          className="sr-only"
          onChange={(e) => setValue?.(e.target.files?.[0]?.name ?? "")}
        />
      </label>
    </div>
  );
}

// --- disclosure & accordion -----------------------------------------------------

function Disclosure({ node, props, children }: MosaicBlockProps) {
  const label = str(props.label) || "Details";
  const [open, setOpen] = React.useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-xl border">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left font-medium text-sm">
        <ChevronRight
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
        />
        {label}
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="px-3 pb-3 ps-9">
          <Flow node={node}>{children}</Flow>
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

function AccordionRow({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2.5 text-left font-medium text-sm">
        <ChevronRight
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
        />
        {label}
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="px-3 pb-3 ps-9">{children}</div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

function Accordion({ props, children }: MosaicBlockProps) {
  const labels = strs(props.items);
  const panels = React.Children.toArray(children);
  return (
    <div className="divide-y overflow-hidden rounded-xl border">
      {labels.map((label, i) => (
        <AccordionRow key={label} label={label}>
          {panels[i] ?? null}
        </AccordionRow>
      ))}
    </div>
  );
}

// --- tree & board ---------------------------------------------------------------

type TreeItem = { label: string; children?: TreeItem[] };

function toTreeItems(v: PV | undefined): TreeItem[] {
  return arr(v).map((n) => {
    const o = (n && typeof n === "object" && !Array.isArray(n) ? n : {}) as Record<string, PV>;
    const item: TreeItem = { label: str(o.label) };
    if (o.children) item.children = toTreeItems(o.children);
    return item;
  });
}

function TreeNodes({ nodes, depth }: { nodes: TreeItem[]; depth: number }): React.ReactNode {
  return (
    <ul className={cn(depth > 0 && "ms-2 border-l ps-3")}>
      {nodes.map((n) => {
        const hasKids = (n.children?.length ?? 0) > 0;
        return (
          <li key={n.label} className="py-0.5">
            <div className="flex items-center gap-1.5 text-sm">
              <MosaicIcon
                name={hasKids ? "folder" : "file"}
                className="size-3.5 text-muted-foreground"
              />
              <span className="min-w-0 truncate">{n.label}</span>
            </div>
            {hasKids ? <TreeNodes nodes={n.children ?? []} depth={depth + 1} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

function Tree({ props }: MosaicBlockProps) {
  return <TreeNodes nodes={toTreeItems(props.items)} depth={0} />;
}

function Board({ props }: MosaicBlockProps) {
  const items = arr(props.items).map((it) => {
    const o = (it && typeof it === "object" && !Array.isArray(it) ? it : {}) as Record<string, PV>;
    return { title: str(o.title), column: str(o.column) };
  });
  const columns: string[] = [];
  for (const it of items) if (!columns.includes(it.column)) columns.push(it.column);
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {columns.map((col) => {
        const cards = items.filter((it) => it.column === col);
        return (
          <div
            key={col || "_untitled"}
            className="flex min-w-0 shrink-0 basis-60 flex-col gap-2 rounded-xl bg-muted/50 p-2"
          >
            <div className="flex items-center justify-between px-1">
              <span className={LABEL}>{col || "Untitled"}</span>
              <span className="text-muted-foreground text-xs">{cards.length}</span>
            </div>
            {cards.map((card) => (
              <div
                key={`${col}-${card.title}`}
                className="rounded-lg border bg-card p-2.5 text-sm shadow-xs/5"
              >
                {card.title}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// --- calendar -------------------------------------------------------------------

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function Calendar({ props }: MosaicBlockProps) {
  const items = arr(props.items)
    .map((it) => {
      const o = (it && typeof it === "object" && !Array.isArray(it) ? it : {}) as Record<string, PV>;
      return { date: str(o.date), title: str(o.title) };
    })
    .filter((it) => /^\d{4}-\d{2}-\d{2}/.test(it.date));

  // Show the month of the earliest dated item (an artifact's data is baked in, so
  // there is a definite month to render); fall back to the current month.
  const earliest = items.map((it) => it.date.slice(0, 10)).sort()[0];
  const base = earliest ? new Date(`${earliest}T00:00:00`) : new Date();
  const year = base.getFullYear();
  const month = base.getMonth();
  const monthLabel = base.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const byDay = new Map<number, string[]>();
  for (const it of items) {
    const d = new Date(`${it.date.slice(0, 10)}T00:00:00`);
    if (d.getFullYear() === year && d.getMonth() === month) {
      const day = d.getDate();
      byDay.set(day, [...(byDay.get(day) ?? []), it.title]);
    }
  }

  const cells: { key: string; day: number | null }[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push({ key: `pad-${WEEKDAYS[i]}`, day: null });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ key: `d${d}`, day: d });

  return (
    <div className="flex flex-col gap-2">
      <div className="font-medium text-sm">{monthLabel}</div>
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((w) => (
          <div key={w} className="pb-1 text-center text-[10px] text-muted-foreground uppercase">
            {w}
          </div>
        ))}
        {cells.map((cell) => {
          const { day } = cell;
          const events = day ? byDay.get(day) : undefined;
          return (
            <div
              key={cell.key}
              className={cn("min-h-14 rounded-lg border p-1", day ? "bg-card" : "border-transparent")}
            >
              {day ? (
                <>
                  <div
                    className={cn(
                      "text-right text-xs",
                      events ? "font-semibold text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {day}
                  </div>
                  {events?.slice(0, 2).map((title) => (
                    <div
                      key={`${day}-${title}`}
                      title={title}
                      className="mt-0.5 truncate rounded bg-primary/12 px-1 py-0.5 text-[10px] text-primary"
                    >
                      {title}
                    </div>
                  ))}
                  {events && events.length > 2 ? (
                    <div className="mt-0.5 text-[10px] text-muted-foreground">+{events.length - 2}</div>
                  ) : null}
                </>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- graceful escapes -----------------------------------------------------------
// A full Vega-Lite runtime and a sanitized-SVG pipeline are heavier than this
// dependency-light renderer should pull in, so these two degrade to their alt -
// on-brand, and meaning intact - rather than falling back to the reference paint.

function VegaChart({ props }: MosaicBlockProps<BlockPropTypes["VegaChart"]>) {
  return <BlockPlaceholder icon="chart-column" label={str(props.alt)} hint="Vega-Lite chart" />;
}

function Canvas({ props }: MosaicBlockProps<BlockPropTypes["Canvas"]>) {
  return <BlockPlaceholder icon="shapes" label={str(props.alt)} hint="Canvas" />;
}

export const mosaicComponents = defineComponents({
  Stack,
  Grid,
  Box,
  Card,
  Divider,
  Heading,
  Text,
  Icon,
  Badge,
  Tag: Badge,
  Avatar,
  Callout,
  Link,
  Code,
  Markdown,
  Button,
  Input,
  Select,
  MultiSelect,
  Autocomplete,
  Checkbox,
  Radio,
  Toggle,
  Slider,
  Field,
  TagInput,
  DatePicker,
  ColorPicker,
  SegmentedControl,
  Tabs,
  Progress,
  Steps,
  Empty,
  Stat,
  DataTable,
  Timeline,
  List,
  Chart,
  Diagram,
  Image: ImageBlock,
  Video: VideoBlock,
  Audio: AudioBlock,
  Carousel,
  Rating,
  FilePicker,
  Disclosure,
  Accordion,
  Tree,
  Board,
  Calendar,
  VegaChart,
  Canvas,
});
