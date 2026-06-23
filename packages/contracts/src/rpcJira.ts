// EMPOWERRD: fork-owned WS RPC group. Lives in its own module and is merged into
// the protocol via `WsRpcGroup.merge(ForkWsRpcGroup)` in rpc.ts, so the upstream
// WsRpcGroup definition (and the ws.ts handler object) are never edited.
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import {
  JiraOperationError,
  SetThreadJiraKeyInput,
  ThreadJiraKey,
  ThreadJiraKeyList,
} from "./jira.ts";

export const JIRA_WS_METHODS = {
  setThreadJiraKey: "jira.setThreadJiraKey",
  listThreadJiraKeys: "jira.listThreadJiraKeys",
} as const;

export const WsThreadSetJiraKeyRpc = Rpc.make(JIRA_WS_METHODS.setThreadJiraKey, {
  payload: SetThreadJiraKeyInput,
  success: ThreadJiraKey,
  error: JiraOperationError,
});

export const WsThreadListJiraKeysRpc = Rpc.make(JIRA_WS_METHODS.listThreadJiraKeys, {
  payload: Schema.Struct({}),
  success: ThreadJiraKeyList,
  error: JiraOperationError,
});

export const ForkWsRpcGroup = RpcGroup.make(WsThreadSetJiraKeyRpc, WsThreadListJiraKeysRpc);
