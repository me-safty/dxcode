# Epic 02: Additive Architecture

## Direction

The MVP should be additive in the monorepo. Use `t3work` to mark additive packages and
keep ownership obvious.

Suggested structure:

```text
apps/web/src/t3work
packages/t3work-context
packages/t3work-recipes
packages/t3work-integrations-core
packages/t3work-integrations-atlassian
packages/t3work-artifacts
packages/t3work-skill-packs
packages/t3work-t3-adapter
```

The existing `apps/web`, `apps/server`, and core packages should remain the upstream
engine. `t3work` can duplicate UI patterns, but should avoid scattering
`t3work` behavior through existing files.

## T3 Adapter Boundary

`packages/t3work-t3-adapter` is the only package allowed to depend on unstable T3
internals or deep imports.

Responsibilities:

- create/upsert T3 projects
- create managed workspace directories
- start T3 threads
- attach structured external context to a thread
- map T3 project/thread state into `t3work` state
- normalize current T3 assumptions such as `workspaceRoot`

Rule:

```text
apps/web/src/t3work -> packages/t3work-t3-adapter -> existing T3 internals
```

No other `t3work` package should deep import existing T3 internals.

## Project Context Package

`packages/t3work-context` defines the shared model.

Core concepts:

- project
- project source
- managed workspace
- external resource reference
- resource snapshot
- context attachment
- project profile
- project memory document

This package should contain schemas and deterministic helpers, not service clients.

## Integration Core Package

`packages/t3work-integrations-core` defines service-agnostic interfaces.

The first implementation is Atlassian, but the abstractions should also fit Linear,
GitHub Issues, Azure DevOps, Notion, Zendesk, and local files.

Core interface:

```ts
type IntegrationProvider = {
  id: string;
  kind: string;
  listAccounts(): Promise<IntegrationAccount[]>;
  listProjects(account: IntegrationAccountRef): Promise<ExternalProject[]>;
  listResources(input: ListResourcesInput): Promise<ResourcePage>;
  getResource(ref: ResourceRef): Promise<ResourceSnapshot>;
  search(input: IntegrationSearchInput): Promise<ResourceSearchResult[]>;
  getAvailableActions(ref: ResourceRef): Promise<IntegrationAction[]>;
  prepareMutation(input: PrepareMutationInput): Promise<PreparedMutation>;
  commitMutation(input: CommitMutationInput): Promise<MutationResult>;
};
```

## Managed Workspace

`t3work` should create a local workspace automatically when the project does
not start from a user-selected folder.

Default layout:

```text
~/Library/Application Support/T3 Code/t3work/projects/<project-id>/
  project.json
  recipes/
  sources/
  plans/
  documents/
  cache/
  memory/
  runs/
    <run-id>/
      recipe/
```

T3 can still receive a real `workspaceRoot`; the user-facing shell simply treats it as
managed implementation detail.

## Compatibility Strategy

Use stable contracts first. Use deep imports only where necessary, and only inside
`packages/t3work-t3-adapter`.

When a missing extension point becomes obvious, prefer a small upstreamable addition to
T3 over a `t3work`-specific patch.

Likely future extension points:

- project metadata beyond `workspaceRoot`
- structured context attachment
- managed workspace creation
- recipe-launched thread bootstrap
- artifact references in thread messages
