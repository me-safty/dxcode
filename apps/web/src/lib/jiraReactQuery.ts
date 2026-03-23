import { queryOptions } from "@tanstack/react-query";
import { ensureNativeApi } from "../nativeApi";

export function jiraListQueryOptions(input?: {
  assignee?: string;
  status?: string;
  maxResults?: number;
}) {
  return queryOptions({
    queryKey: ["jira", "list", input],
    queryFn: () => ensureNativeApi().jira.list(input ?? {}),
  });
}

export function jiraGetQueryOptions(ticketKey: string) {
  return queryOptions({
    queryKey: ["jira", "get", ticketKey],
    queryFn: () => ensureNativeApi().jira.get({ ticketKey }),
    enabled: !!ticketKey,
  });
}

export function jiraSearchQueryOptions(jql: string, maxResults?: number) {
  return queryOptions({
    queryKey: ["jira", "search", jql, maxResults],
    queryFn: () => ensureNativeApi().jira.search({ jql, maxResults }),
    enabled: !!jql,
  });
}
