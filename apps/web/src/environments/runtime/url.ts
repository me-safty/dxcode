import { getKnownEnvironmentHttpBaseUrl } from "@t3tools/client-runtime";
import type { EnvironmentId } from "@t3tools/contracts";

import { getPrimaryKnownEnvironment } from "../primary/bootstrap";
import { resolveHttpUrlFromBase } from "../shared/url";
import { getSavedEnvironmentRecord } from "./savedEnvironmentsStore";
import { readWsRpcClientEntryForEnvironment } from "../../wsRpcClient";

function resolveEnvironmentHttpBaseUrl(environmentId: EnvironmentId): string | null {
  const activeEntry = readWsRpcClientEntryForEnvironment(environmentId);
  if (activeEntry) {
    const activeBaseUrl = getKnownEnvironmentHttpBaseUrl(activeEntry.knownEnvironment);
    if (activeBaseUrl) {
      return activeBaseUrl;
    }
  }

  const savedRecord = getSavedEnvironmentRecord(environmentId);
  if (savedRecord) {
    return savedRecord.httpBaseUrl;
  }

  const primaryEnvironment = getPrimaryKnownEnvironment();
  if (!primaryEnvironment || primaryEnvironment.environmentId !== environmentId) {
    return null;
  }

  return getKnownEnvironmentHttpBaseUrl(primaryEnvironment);
}

export function resolveEnvironmentHttpUrl(input: {
  readonly environmentId: EnvironmentId;
  readonly pathname: string;
  readonly searchParams?: Record<string, string>;
}): string {
  const baseUrl = resolveEnvironmentHttpBaseUrl(input.environmentId);
  if (!baseUrl) {
    throw new Error(`Unable to resolve HTTP base URL for environment ${input.environmentId}.`);
  }

  return resolveHttpUrlFromBase({
    httpBaseUrl: baseUrl,
    pathname: input.pathname,
    ...(input.searchParams ? { searchParams: input.searchParams } : {}),
  });
}
