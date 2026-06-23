// EMPOWERRD: use the merged protocol (upstream + fork Jira RPCs) so the generic
// EnvironmentRpc.request(tag, ...) path can call jira.* methods.
import { AllWsRpcGroup } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { RpcClient } from "effect/unstable/rpc";

export const makeWsRpcProtocolClient = RpcClient.make(AllWsRpcGroup);
type RpcClientFactory = typeof makeWsRpcProtocolClient;
export type WsRpcProtocolClient =
  RpcClientFactory extends Effect.Effect<infer Client, any, any> ? Client : never;
