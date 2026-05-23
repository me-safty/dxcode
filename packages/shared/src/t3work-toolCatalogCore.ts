export type T3workToolCapability = "read" | "write";
export type T3workToolKind =
  | "read"
  | "view-state"
  | "draft-mutation"
  | "thread"
  | "external-convenience";
export type T3workToolSurface =
  | "thread"
  | "project"
  | "backlog"
  | "my-work"
  | "work-item"
  | "github";
export type T3workToolStatus = "implemented" | "planned";

export type T3workToolCatalogEntry = {
  readonly id: string;
  readonly label: string;
  readonly title: string;
  readonly description: string;
  readonly capabilities: ReadonlyArray<T3workToolCapability>;
  readonly kind: T3workToolKind;
  readonly surfaces: ReadonlyArray<T3workToolSurface>;
  readonly status: T3workToolStatus;
  readonly defaultEnabled?: boolean;
  readonly inputSchema: unknown;
};

const READ_CAPABILITIES = ["read"] as const;
const WRITE_CAPABILITIES = ["write"] as const;

export const EMPTY_OBJECT_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {},
} as const;

function defaultCapabilitiesForKind(kind: T3workToolKind): ReadonlyArray<T3workToolCapability> {
  return kind === "read" ? READ_CAPABILITIES : WRITE_CAPABILITIES;
}

function titleCaseToken(token: string): string {
  switch (token) {
    case "github":
      return "GitHub";
    case "jira":
      return "Jira";
    case "jql":
      return "JQL";
    default:
      return token.charAt(0).toUpperCase() + token.slice(1);
  }
}

function humanizeToolId(id: string): string {
  return id
    .replace(/^t3work\./, "")
    .split(".")
    .flatMap((segment) => segment.split("_"))
    .map(titleCaseToken)
    .join(" ");
}

export function definePlannedTools(input: {
  readonly kind: T3workToolKind;
  readonly surfaces: ReadonlyArray<T3workToolSurface>;
  readonly ids: ReadonlyArray<string>;
}): ReadonlyArray<T3workToolCatalogEntry> {
  return input.ids.map((id) => {
    const title = humanizeToolId(id);
    return {
      id,
      label: title,
      title,
      description: `Planned ${title.toLowerCase()} tool.`,
      capabilities: defaultCapabilitiesForKind(input.kind),
      kind: input.kind,
      surfaces: input.surfaces,
      status: "planned",
      inputSchema: EMPTY_OBJECT_INPUT_SCHEMA,
    } satisfies T3workToolCatalogEntry;
  });
}

export function hasT3workToolSurface(
  tool: T3workToolCatalogEntry,
  surface: T3workToolSurface,
): boolean {
  return tool.surfaces.some((candidate) => candidate === surface);
}
