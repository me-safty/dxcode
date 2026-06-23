// EMPOWERRD: chat-header button that deep-links to Jira. Gated on JIRA_DOMAIN.
// With a key set on the thread it opens the issue; otherwise the create-issue page.
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { buildJiraCreateTicketUrl, buildJiraTicketUrl } from "@t3tools/shared/jira";
import { TicketIcon } from "lucide-react";

import { Button } from "../components/ui/button";
import { useEnvironmentQuery } from "../state/query";
import { primaryServerConfigAtom } from "../state/server";
import { threadJiraKeysQuery } from "./state.ts";

export function JiraTicketButton(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const { environmentId, threadId } = props;
  const config = useAtomValue(primaryServerConfigAtom);
  const jiraDomain = config?.jira?.domain ?? null;
  const jiraKeysQuery = useEnvironmentQuery(threadJiraKeysQuery({ environmentId, input: {} }));
  const jiraKey = jiraKeysQuery.data?.find((row) => row.threadId === threadId)?.jiraKey ?? null;

  if (!jiraDomain) {
    return null;
  }

  const href = jiraKey
    ? buildJiraTicketUrl(jiraDomain, jiraKey)
    : buildJiraCreateTicketUrl(jiraDomain);
  const label = jiraKey ? "Open Ticket" : "Create Ticket";

  return (
    <Button
      size="xs"
      variant="outline"
      render={<a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} />}
    >
      <TicketIcon aria-hidden="true" className="size-3.5" />
      {label}
    </Button>
  );
}
