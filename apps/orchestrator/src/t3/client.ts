import {
  type ExecutionRunCreateRequest,
  ExecutionRunCreateResponse,
  type ExecutionRunCreateResponse as ExecutionRunCreateResponseType,
} from "@t3tools/contracts";
import { Schema } from "effect";

const decodeExecutionRunCreateResponse = Schema.decodeUnknownSync(ExecutionRunCreateResponse);

function requiredEnv(name: "T3_EXECUTION_BRIDGE_BASE_URL" | "T3_EXECUTION_BRIDGE_SHARED_SECRET") {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required orchestrator environment variable: ${name}`);
  }
  return value;
}

export interface T3ExecutionBridgeClient {
  readonly createExecutionRun: (
    request: ExecutionRunCreateRequest,
  ) => Promise<ExecutionRunCreateResponseType>;
}

export function createT3ExecutionBridgeClient(): T3ExecutionBridgeClient {
  const baseUrl = requiredEnv("T3_EXECUTION_BRIDGE_BASE_URL").replace(/\/$/, "");
  const sharedSecret = requiredEnv("T3_EXECUTION_BRIDGE_SHARED_SECRET");

  return {
    async createExecutionRun(request) {
      const response = await fetch(`${baseUrl}/api/execution/runs`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${sharedSecret}`,
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(
          `T3 execution bridge rejected run create (${response.status}): ${detail || "Unknown error"}`,
        );
      }

      return decodeExecutionRunCreateResponse(await response.json());
    },
  };
}
