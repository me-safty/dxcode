# Epic 06: Recipes And Skills

## Purpose

Recipes turn blank chat into contextual actions. A recipe is a visible UI launcher backed
by a skill.

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
