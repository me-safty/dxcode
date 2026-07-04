import * as Effect from "effect/Effect";

import type { WorkflowSourceConfig } from "../../contracts/workSource.ts";
import type {
  ExternalWorkItem,
  WorkSourcePage,
  WorkSourceProvider,
  WorkSourceProviderError,
} from "./Services/WorkSourceProvider.ts";

export const MAX_PAGES_PER_SOURCE_TICK = 10;
export const MAX_ITEMS_PER_SOURCE_TICK = 500;
export const MAX_DELTAS_PER_RECONCILE_CHUNK = 50;

export interface ScanResult {
  readonly items: ReadonlyArray<ExternalWorkItem>;
  readonly scanCompleted: boolean;
}

export const chunkArray = <A>(
  items: ReadonlyArray<A>,
  size: number,
): ReadonlyArray<ReadonlyArray<A>> => {
  const out: Array<ReadonlyArray<A>> = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
};

export const scanSource = (
  provider: WorkSourceProvider,
  source: WorkflowSourceConfig,
  since: string | undefined,
): Effect.Effect<ScanResult, WorkSourceProviderError> =>
  Effect.gen(function* () {
    const items: Array<ExternalWorkItem> = [];
    let pageToken: string | undefined = undefined;
    let scanCompleted = false;

    for (let page = 0; page < MAX_PAGES_PER_SOURCE_TICK; page++) {
      const fetched: WorkSourcePage = yield* provider.listPage({
        connectionRef: source.connectionRef,
        selector: source.selector,
        ...(since === undefined ? {} : { since }),
        ...(pageToken === undefined ? {} : { pageToken }),
        pageSize: 100,
      });

      for (const item of fetched.items) items.push(item);

      if (fetched.nextPageToken === undefined) {
        scanCompleted = true;
        break;
      }
      if (items.length >= MAX_ITEMS_PER_SOURCE_TICK) {
        scanCompleted = false;
        break;
      }
      pageToken = fetched.nextPageToken;
    }

    return { items, scanCompleted } satisfies ScanResult;
  });

export const describeWorkSourceProviderError = (error: WorkSourceProviderError): string => {
  switch (error._tag) {
    case "WorkSourceRateLimitError":
      return `rate-limited (retryAfterMs=${error.retryAfterMs})`;
    case "WorkSourceAuthError":
      return `auth failed (connectionRef=${error.connectionRef})`;
    case "WorkSourceTransientError":
    case "WorkSourceConfigError":
      return `${error._tag}: ${error.message}`;
  }
};
