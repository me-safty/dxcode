# Epic 04: Integration Platform

## Purpose

The integration platform allows projects to be created from external systems and lets
skills read external context through a stable tool surface.

Atlassian is the first implementation, not the abstraction.

## Core Concepts

### Integration Account

An authenticated account or site connection.

```ts
type IntegrationAccount = {
  id: string;
  provider: string;
  label: string;
  accountUrl?: string;
};
```

### External Project

A project-like object exposed by an integration.

```ts
type ExternalProject = {
  id: string;
  provider: string;
  title: string;
  key?: string;
  url?: string;
  description?: string;
  raw?: unknown;
};
```

### Resource Ref

A stable pointer to an external object.

```ts
type ResourceRef = {
  provider: string;
  kind: string;
  id: string;
  displayId?: string;
  title: string;
  url?: string;
  projectId?: string;
};
```

### Resource Snapshot

A normalized, cached copy of an external resource.

```ts
type ResourceSnapshot = {
  ref: ResourceRef;
  fetchedAt: string;
  summary?: string;
  fields: Record<string, unknown>;
  text?: string;
  raw?: unknown;
};
```

## Provider Interface

Every provider should support discovery, reading, search, action discovery, and
reviewable mutation flows.

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

## Mutation Design

All external writes should be two-step:

1. `prepareMutation` returns a reviewable mutation model.
2. `commitMutation` executes only after explicit approval.

This lets skills draft useful work while keeping user consent clear.

## Caching

The platform should cache:

- project lists
- resource lists
- resource snapshots
- search results where useful
- mutation audit records

Cache should live in the managed workspace under `sources/<provider>/` and `cache/`.

## Future Providers

The same model should fit:

- Linear teams/issues
- GitHub repositories/issues/pull requests
- Azure DevOps projects/work items
- Notion databases/pages
- Zendesk groups/tickets
- local file collections
