# Epic 16: Action Recipes

## Purpose

Action recipes are project-scoped, context-aware workflow launchers.

They are similar to agent skills, but they are visible app actions first. They can render
inside the project dashboard and resource detail side panel before the user opens chat.
When launched, the recipe is instantiated into a run directory and the agent receives
only the path to that instantiated recipe.

## Scope

The first implementation should support project-scoped recipes only.

Personal recipes and company-owned internal recipe collections are later extensions of
the same model. The MVP should not optimize around public marketplace security because
recipes are trusted local or project-owned code.

## Core Model

```ts
type ActionRecipeTemplate = {
  id: string;
  version: string;
  scope: "project";
  manifestPath: string;
  displayName: TemplateExpression<string>;
  shortDescription?: TemplateExpression<string>;
  icon?: TemplateExpression<string>;
  surfaces: ActionRecipeSurface[];
  rank?: TemplateExpression<number>;
  visibleWhen?: RecipeVisibilityRule;
  actionView?: RecipeMdxRef;
  prompt: RecipeTemplateFileRef;
  files?: RecipeTemplateFileRef[];
  initScript?: RecipeScriptRef;
  allowedToolGroups?: string[];
  outputPreference?: RichOutputPreference;
};

type ActionRecipeInstance = {
  id: string;
  templateId: string;
  templateVersion: string;
  projectId: string;
  surface: ActionRecipeSurface;
  sourceContextRefs: ResourceRef[];
  instancePath: string;
  createdAt: string;
  initResultPath?: string;
};

type ActionRecipeSurface =
  | "project.dashboard"
  | "workitem.detail.sidepanel"
  | "thread.context"
  | "github.pull_request.detail.sidepanel"
  | "github.pull_request.diff.selection"
  | "github.review.comment";
```

These remain project-scoped surfaces because the GitHub views are still rooted in a
project-linked repository resource. The next planned expansion is first-class GitHub PR
recipes on the PR detail page, diff selection menu, and review comment threads.

## Profile-Aware And Convention-Aware Recipes

The render and full context already include `profile`, so recipes should use that
directly instead of duplicating profile logic elsewhere.

Profile-aware does not mean profile-name-aware.

Recipes and action views must not branch on `profile.id`, `profile.title`, or any assumed
built-in profile list. They should branch on lower-level preference fields such as:

- `profile.communicationStyle.technicalDepth`
- `profile.communicationStyle.guidanceStyle`
- `profile.communicationStyle.brevity`
- `profile.surfaceDefaults`
- `profile.preferredArtifactKinds`
- `profile.defaultActionFamilies`
- `profile.defaultRecipeWeights`

The same recipe template may change all of these by profile:

- label and short description
- rank and visibility
- action view copy and call-to-action tone
- prompt instructions and expected output shape
- which sections are expanded first in the action preview

Examples for the same GitHub PR context:

- high technical depth + expert guidance: `Deep review this PR` with diff-heavy wording
  and technical risk framing
- guided detail density + release/deployment action preference: `Explain what changed and
what to test` with change buckets, checks, and deployment cues first
- low technical depth + short brevity + summary-first defaults: `Explain customer and
rollout impact` with low-jargon summary

Project-scoped recipes should also be able to rely on project-local conventions for:

- pull request body templates
- required release-note or rollout sections
- deployment links and environment names
- reviewer or approver guidance

The next GitHub action slice should prioritize recipes such as:

- explain what this PR does
- create a PR from the current branch using the project template
- show where this PR is deployed
- prepare a release or QA handoff

Projects may still ship starter profiles that happen to produce these behaviors, but the
recipe engine should only observe the declared preference fields, not the starter profile
names.

## Template Directory

A recipe is a directory, not a single prompt file.

```text
recipes/
  qa-test-plan/
    recipe.json
    prompt.md
    action.mdx
    visible.ts
    init.ts
    files/
      test-plan.md
      jira-comment.md
    fixtures/
      jira-story.context.json
```

`recipe.json` owns metadata and file references. All referenced files may contain
template expressions.

## Pre-Launch Rendering

Recipe actions render before instantiation. The dashboard and side panel need metadata
such as label, icon, description, rank, and visibility while the user is still browsing.

This uses a smaller render context:

```ts
type ActionRecipeRenderContext = {
  surface: ActionRecipeSurface;
  project: ProjectRenderContext;
  workitem?: WorkItemRenderContext;
  linkedResources: ResourceRenderSummary[];
  artifacts: ArtifactRenderSummary[];
  profile: ProfileRenderContext;
  enabledSkillPacks: string[];
  schema: RecipeContextSchemaIndex;
};
```

Example manifest:

```json
{
  "id": "qa-test-plan",
  "version": "0.1.0",
  "scope": "project",
  "displayName": "Create QA plan for {{ workitem.displayId ?? 'selected work' }}",
  "shortDescription": "Build a test matrix from current ticket context",
  "icon": "{{ workitem.type === 'Bug' ? 'bug' : 'clipboard-check' }}",
  "surfaces": ["workitem.detail.sidepanel"],
  "rank": "{{ workitem.priority === 'High' ? 90 : 50 }}",
  "visibleWhen": "./visible.ts",
  "actionView": "./action.mdx",
  "prompt": "./prompt.md",
  "files": ["./files/test-plan.md", "./files/jira-comment.md"],
  "initScript": "./init.ts",
  "allowedToolGroups": ["integration.read", "artifact.rw", "ui.render"]
}
```

## Visibility Rules

Visibility can start with deterministic expressions and grow into scripts.

Simple expression:

```json
{
  "visibleWhen": {
    "kind": "expr",
    "expr": "surface === 'workitem.detail.sidepanel' && workitem?.provider === 'jira'"
  }
}
```

Script rule:

```ts
export async function visible(ctx, api) {
  const issueType = ctx.workitem?.type;

  return {
    visible: issueType === "Story" || issueType === "Bug",
    rank: issueType === "Bug" ? 85 : 60,
    reason: "QA planning applies to Jira stories and bugs",
  };
}
```

Scripts run in their own recipe evaluation context. They may use local system access and
scoped tools because recipes are trusted project code. The implementation should still
record evaluation errors and timeouts so a broken recipe does not break the whole page.

## Recipe Script Runtime

For the MVP, recipe scripts should run server-side on the host Node runtime.

- Desktop uses the Node runtime already bundled inside Electron.
- Standalone/server deployments should require Node 24+ for recipe-script support.
- Do not ship Bun as a recipe runtime.
- Do not install a script runtime or third-party dependencies on demand.

This keeps recipe execution inside the runtime the app already owns and avoids adding a
second shipped JavaScript engine just for project-local scripts.

### File Types

Use these file names for recipe-owned code:

- `visible.ts`
- `init.ts`
- relative helper modules such as `helpers.ts`

`action.mdx` stays separate. It is a renderable action view, not a general-purpose Node
script entrypoint.

### Module Contract

Recipe scripts are ESM modules loaded with normal server-side `import(...)`.

```ts
type RecipeVisibilityResult = {
  visible: boolean;
  rank?: number;
  reason?: string;
};

type RecipeInitResult = {
  summary?: string;
  filesWritten?: string[];
  metadata?: Record<string, unknown>;
};

type RecipeScriptApi = {
  tools: {
    call<TOutput = unknown>(name: string, input?: Record<string, unknown>): Promise<TOutput>;
    readResource(uri: string): Promise<unknown>;
  };
  workspace: {
    rootPath: string;
    recipePath: string;
    runPath?: string;
    readText(relativePath: string): Promise<string>;
    writeText(relativePath: string, content: string): Promise<void>;
    exists(relativePath: string): Promise<boolean>;
  };
  log: {
    info(message: string, fields?: Record<string, unknown>): void;
    warn(message: string, fields?: Record<string, unknown>): void;
    error(message: string, fields?: Record<string, unknown>): void;
  };
  fetch: typeof fetch;
};

export type RecipeVisibleModule = {
  visible: (
    ctx: ActionRecipeRenderContext,
    api: RecipeScriptApi,
  ) => Promise<boolean | RecipeVisibilityResult> | boolean | RecipeVisibilityResult;
};

export type RecipeInitModule = {
  init: (
    ctx: ActionRecipeContext,
    api: RecipeScriptApi,
  ) => Promise<void | RecipeInitResult> | void | RecipeInitResult;
};
```

Contract rules:

- `visible.ts` must export `visible`.
- `init.ts` must export `init`.
- `api.tools` is capability-scoped from `allowedToolGroups` and should be the preferred
  way to interact with t3work state.
- `api.fetch` and Node built-ins may still be used directly because recipes are trusted
  project code in the MVP.
- If a script needs reusable helpers, keep them in the recipe directory and import them
  with relative paths.

### Supported TypeScript Subset

Scripts should use only TypeScript syntax that Node 24 can run with built-in type
stripping.

Supported authoring style:

- ESM modules
- type annotations
- interfaces and type aliases
- generics
- `import type`
- relative imports to other `.ts` files in the recipe
- `node:` built-in imports

Unsupported for the MVP:

- JSX or `.tsx`
- decorators
- `enum`
- namespaces with runtime output
- parameter properties
- CommonJS modules
- tsconfig path aliases such as `~/foo` or `@/foo`
- package imports that require `npm` or `bun install`
- any TypeScript feature that needs emit/transforms beyond stripping types

Authoring rule:

```text
If the script would need TypeScript compilation to change runtime behavior,
it is out of scope for the MVP.
```

This is intentionally conservative. It gives recipe authors native TypeScript ergonomics
without forcing the product to bundle a compiler/transpiler pipeline for project-local
scripts.

### Dependency Policy

Recipe scripts should not declare or depend on third-party packages.

- No `package.json` inside recipes.
- No per-project `npm install` or `bun install` step.
- No hidden background dependency resolution.

If a recipe needs a capability repeatedly, expose it through the host `RecipeScriptApi`
or a t3work tool instead of asking recipe authors to install a library.

### Execution Rules

- `visible.ts` should be fast and mostly side-effect-free.
- `init.ts` may write local files and prepare run artifacts.
- Direct external writes should still prefer t3work tools so results remain reviewable in
  the UI.
- Script failures must be isolated to the current recipe.
- Visibility timeouts should hide only the broken recipe.
- Init failures should be recorded in `init-result.json` and surfaced in the run.

Suggested runtime limits:

- `visible.ts`: 1-2s budget
- `init.ts`: 5-10s budget

The host may implement this isolation with a worker thread or child process. Recipe
authors should only depend on the stable module contract above.

## MDX Action Views

`action.mdx` renders the clickable recipe action. It should receive context as props and
use app-owned components.

```tsx
export default function Action({ ctx }) {
  return (
    <RecipeAction
      title={`Create QA plan for ${ctx.workitem?.displayId ?? "selected work"}`}
      subtitle={ctx.workitem?.title}
      icon={ctx.workitem?.type === "Bug" ? "bug" : "clipboard-check"}
    />
  );
}
```

The MVP can restrict this to known components first:

- `RecipeAction`
- `Badge`
- `FieldList`
- `SourceLink`
- `RiskPill`
- `ArtifactLink`

The important contract is that the MDX renders from data context before launch and does
not need to start a chat by itself. The shell owns the click behavior.

## Instantiation

When clicked, the shell materializes a recipe instance under the managed project
workspace.

```text
runs/
  <run-id>/
    recipe/
      recipe.json
      context.json
      context.schema.json
      context-map.md
      prompt.md
      action.mdx
      files/
        test-plan.md
        jira-comment.md
      init-result.json
```

Instantiation steps:

1. Build full context for the selected project and optional work item.
2. Render all templated metadata and files.
3. Copy rendered contents into the instance directory.
4. Write `context.json`, `context.schema.json`, and `context-map.md`.
5. Run optional `init.ts`.
6. Start or focus the normal chat thread.
7. Insert a special recipe launch message, not a normal user message.
8. Instruct the agent to follow the instantiated recipe path.

Agent bootstrap:

```md
Follow the instantiated action recipe at:
<absolute-instance-path>

Read recipe.json first, then prompt.md.
Use context.json as source data.
Persist durable outputs as artifacts when appropriate.
```

## Full Context Contract

The full context is richer than the pre-launch render context.

```ts
type ActionRecipeContext = {
  project: T3WorkProjectSnapshot;
  workitem?: ResourceSnapshot;
  selectedResource?: ResourceSnapshot;
  linkedResources: ResourceSnapshot[];
  sourceProject?: ExternalProjectSnapshot;
  artifacts: RichArtifactSummary[];
  recentRuns: RecipeRunSummary[];
  profile: T3WorkProfile;
  enabledSkillPacks: string[];
  memory: ProjectMemorySnapshot;
  capabilities: RecipeCapabilitySummary;
};
```

The exact schema must be discoverable by both humans and agents. Every instance writes:

- `context.json`: concrete data for this launch.
- `context.schema.json`: JSON Schema for all available fields.
- `context-map.md`: short field guide with examples and optionality notes.

Example `context-map.md`:

```md
# Recipe Context

## project

- `project.id`: stable t3work project ID.
- `project.name`: display name.
- `project.sources`: connected provider summaries.

## workitem

- `workitem.ref.displayId`: visible issue key, for example `WEB-123`.
- `workitem.ref.title`: issue title.
- `workitem.fields.status`: normalized current status when available.
- `workitem.fields.raw`: provider-specific raw fields.

## artifacts

Prior artifacts linked to this project or work item.
```

## Agent-Created Recipes

Agents may offer to create a new project recipe after a workflow succeeds. This does not
need a dedicated product automation in the MVP. The default behavior can live in the
root `AGENTS.md` instructions for agents working in this repository.

Default behavior:

- Offer first, do not silently create.
- Save under the current project recipe directory.
- Include a fixture from the successful context with secrets redacted.
- Include `context.schema.json` paths used by templates.
- Prefer small reusable files over one large prompt.

Example offer:

```text
This workflow is repeatable. Create a project action recipe named "QA smoke plan"?
```

This keeps recipe growth project-local first without adding hidden background behavior.
Personal scope and company collections can be added after the project recipe format
proves stable.

## Managed Workspace Layout

Project recipes should live next to project data:

```text
<managed-project>/
  project.json
  recipes/
    qa-test-plan/
  runs/
    <run-id>/
      recipe/
  documents/
  cache/
  memory/
```

Bundled recipes from skill packs may be copied or referenced into project scope when a
project is created. Project-local recipes are the editable source of truth for the MVP.

## Implementation Notes

- `packages/t3work-recipes` should own manifest schemas, template rendering,
  visibility evaluation, and instantiation helpers.
- `packages/t3work-context` should own context schemas and `context-map.md`
  generation.
- `apps/web/src/t3work` should render recipe actions, not evaluate provider-specific
  context directly.
- `packages/t3work-t3-adapter` should own thread bootstrap and special recipe launch
  message insertion.
- Visibility failures should hide only the broken recipe and expose diagnostics in an
  advanced/debug surface.
