# Epic 07: Skill Tools And Mutations

## Purpose

Skills need tools that can read integrations, persist useful documents, and prepare
reviewable UI for mutations.

The MVP can start as an internal local tool surface. It should be shaped so it can later
be exposed through MCP.

## Read Tools

- `integration.accounts.list`
- `integration.projects.list`
- `integration.resources.list`
- `integration.resource.get`
- `integration.search`
- `jira.project.issues.list`
- `jira.issue.get`
- `jira.issue.comments.list`

## Artifact Tools

- `artifact.create`
- `artifact.update`
- `artifact.read`
- `artifact.list`
- `plan.create`
- `plan.update`
- `cache.write`
- `cache.read`

## Mutation Tools

- `mutation.prepare`
- `mutation.preview`
- `mutation.commit`
- `jira.comment.prepare`
- `jira.comment.commit`

Mutation commit tools should be unavailable unless the UI has already captured explicit
approval.

## UI Primitive Tools

These tools return structured artifact blocks, not arbitrary client-side code.

- `ui.render.table`
- `ui.render.timeline`
- `ui.render.checklist`
- `ui.render.form`
- `ui.render.diff`
- `ui.render.statusBoard`
- `ui.render.dependencyMap`
- `ui.render.testMatrix`
- `ui.render.mutationPreview`

## Mutation UX

External writes should follow this path:

1. Skill prepares mutation.
2. Shell renders mutation preview.
3. User edits if needed.
4. User approves.
5. Shell commits mutation through integration provider.
6. Shell records result in artifact/run history.

## Permission Model

Tool access should be scoped by:

- project
- recipe
- integration account
- selected resource
- read versus write capability

Default stance:

- reads allowed after integration connection
- mutation preparation allowed for matching resources
- mutation commit requires explicit user approval

## MCP Direction

The internal tool surface should later map cleanly to MCP server tools.

Do not require MCP for the first MVP if that slows down the UI/product validation. The
important part is to design the contracts with MCP-style tool inputs and outputs.
