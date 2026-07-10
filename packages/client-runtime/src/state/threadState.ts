import * as Option from "effect/Option";
import type { ThreadDetailData } from "./windowedThread.ts";

export type EnvironmentThreadStatus = "empty" | "cached" | "synchronizing" | "live" | "deleted";

export interface EnvironmentThreadState {
  readonly data: Option.Option<ThreadDetailData>;
  readonly status: EnvironmentThreadStatus;
  readonly error: Option.Option<string>;
  readonly hasOlder?: boolean;
  readonly loadingOlder?: boolean;
  readonly loadOlder?: () => Promise<void>;
}

export const EMPTY_ENVIRONMENT_THREAD_STATE: EnvironmentThreadState = {
  data: Option.none(),
  status: "empty",
  error: Option.none(),
  hasOlder: false,
  loadingOlder: false,
  loadOlder: () => Promise.resolve(),
};
