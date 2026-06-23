// EMPOWERRD: fork-owned environment atoms for the Jira RPCs. Built on the
// generic RPC command/query factories so the fork plugs into the new web state
// model (atom-command + environment query) exactly like vcs/threads do.
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import { JIRA_WS_METHODS } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";

/** Mutation: set/clear a thread's Jira key (and optionally rename its branch). */
export const setThreadJiraKeyCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "jira set thread key",
  tag: JIRA_WS_METHODS.setThreadJiraKey,
});

/** Query: list every thread's Jira key for an environment. */
export const threadJiraKeysQuery = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "jira list thread keys",
  tag: JIRA_WS_METHODS.listThreadJiraKeys,
});
