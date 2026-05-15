import type {
  CommitMutationInput,
  IntegrationAccount,
  IntegrationAccountRef,
  IntegrationAction,
  IntegrationSearchInput,
  ListResourcesInput,
  MutationResult,
  PrepareMutationInput,
  PreparedMutation,
  ResourceSearchResult,
} from "./types.ts";

import type { ResourcePage, ResourceSnapshot } from "@t3tools/project-context";
import type { ExternalProject } from "./types.ts";

export type IntegrationProvider = {
  readonly id: string;
  readonly kind: string;
  listAccounts(): Promise<ReadonlyArray<IntegrationAccount>>;
  listProjects(account: IntegrationAccountRef): Promise<ReadonlyArray<ExternalProject>>;
  listResources(input: ListResourcesInput): Promise<ResourcePage>;
  getResource(ref: unknown): Promise<ResourceSnapshot>;
  search(input: IntegrationSearchInput): Promise<ReadonlyArray<ResourceSearchResult>>;
  getAvailableActions(ref: unknown): Promise<ReadonlyArray<IntegrationAction>>;
  prepareMutation(input: PrepareMutationInput): Promise<PreparedMutation>;
  commitMutation(input: CommitMutationInput): Promise<MutationResult>;
};
