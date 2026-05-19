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

type ActionRecipeSurface = "project.dashboard" | "workitem.detail.sidepanel" | "thread.context";
```

## Template Directory

A recipe is a directory, not a single prompt file.

```text
recipes/
  qa-test-plan/
    recipe.json
    prompt.md
    action.mdx
    visible.mjs
    init.mjs
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
  "visibleWhen": "./visible.mjs",
  "actionView": "./action.mdx",
  "prompt": "./prompt.md",
  "files": ["./files/test-plan.md", "./files/jira-comment.md"],
  "initScript": "./init.mjs",
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

```js
export async function visible(ctx, tools) {
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
5. Run optional `init.mjs`.
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
