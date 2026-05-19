# Epic 06: Recipes And Skills

## Purpose

Recipes turn blank chat into contextual actions. A recipe is a visible UI launcher backed
by a skill or project-local action recipe.

Action recipes are the stronger project-scoped form: a trusted directory template with
metadata, MDX action UI, templated files, optional visibility script, and optional init
script. When launched, the shell instantiates the directory into the current run and
gives the agent only the instantiated recipe path.

## Recipe Model

```ts
type Recipe = {
  id: string;
  title: string;
  shortDescription: string;
  appliesTo: RecipeApplicability;
  requiredContext: RecipeContextRequirement[];
  skillRef: SkillRef;
  outputPreference: RichOutputPreference;
  suggestedActions?: RecipeFollowup[];
};
```

For action recipes, the flat recipe model becomes the UI-facing projection of a
template directory:

```ts
type ActionRecipeTemplate = {
  id: string;
  version: string;
  scope: "project";
  displayName: TemplateExpression<string>;
  shortDescription?: TemplateExpression<string>;
  icon?: TemplateExpression<string>;
  surfaces: ("project.dashboard" | "workitem.detail.sidepanel")[];
  visibleWhen?: RecipeVisibilityRule;
  actionView?: string;
  prompt: string;
  files?: string[];
  initScript?: string;
};
```

## Recipe Scope

### Skill Pack Recipes

Bundled with `t3work` and enabled by selected skill packs.

Examples:

- QA pack: test plan, acceptance criteria review, bug reproduction guide
- Product pack: requirement summary, stakeholder update, scope risk review
- Support pack: customer-facing explanation, escalation summary, reproduction request
- Delivery pack: release checklist, dependency review, standup summary

### Global Recipes

Shipped with the app and available everywhere.

Examples:

- Explain this simply
- Draft a summary
- Find unclear requirements

### Project-Scoped Recipes

Stored in the managed project workspace.

Examples:

- Run our release checklist
- Use our QA signoff format
- Draft comment using our team tone

Project-scoped action recipes should be the first editable recipe scope. They live under
the managed project workspace in `recipes/<recipe-id>/` and are instantiated into
`runs/<run-id>/recipe/` when launched.

### Workspace-Scoped Recipes

Attached to a local repo/workspace.

Examples:

- Run smoke test plan
- Check implementation against local conventions
- Summarize recent code changes for QA

## Recipe Matching

Inputs:

- active project
- selected resource
- resource kind
- Jira issue type
- project profile
- enabled skill packs
- available integrations
- project memory
- recent artifacts

Outputs:

- ranked recipes
- reason for applicability
- missing context warnings

Action recipe matching also renders pre-launch metadata such as display name, icon,
description, rank, and MDX action view from the current project or work item context.
This is needed because the dashboard and side panel show actions before a recipe is
instantiated.

## Initial Recipes

### Explain Ticket Simply

Output:

- short summary
- user impact
- what needs checking
- unclear points
- source links

### Review Acceptance Criteria

Output:

- acceptance criteria list
- ambiguity warnings
- missing testability notes
- questions for developer/product

### Create QA Test Plan

Output:

- test matrix
- environment assumptions
- edge cases
- regression/smoke split
- estimated effort

### Draft Jira Comment

Output:

- editable comment proposal
- mutation preview

### Summarize Project Risk

Output:

- risk board
- blocked tickets
- unclear tickets
- suggested next actions

## Skill Contract

A recipe launch should provide the skill with:

- project profile
- selected resource snapshots
- allowed tools
- output format preference
- persistence policy
- mutation policy

Skills should save durable artifacts by default and return a concise chat summary only
as a companion.

An action recipe launch should additionally write these files into the instantiated
recipe directory:

- `context.json`
- `context.schema.json`
- `context-map.md`
- rendered `recipe.json`
- rendered prompt and subfiles
- optional `init-result.json`

The schema and context map are part of the authoring contract. Agents creating new
project recipes should inspect them before writing template expressions.

## Product Positioning

Recipes should not assume the user is a QA engineer. QA is the first skill pack, not the
entire product.

The same project, resource, recipe, artifact, and mutation model should support:

- QA and test planning
- product clarification
- support triage
- delivery coordination
- engineering implementation
- release preparation
