import { T3workRecentConversations } from "~/t3work/t3work-ProjectDashboardRecentConversations";
import type { SidecarSectionHost } from "~/t3work/t3work-sidecarSectionHost";
import type { ProjectThread } from "~/t3work/t3work-types";

export type RecentConversationsSectionProps = {
  readonly threads: ReadonlyArray<ProjectThread>;
  readonly emptyMessage?: string | undefined;
  readonly searchPlaceholder?: string | undefined;
  readonly showSearch?: boolean | undefined;
  readonly showCount?: boolean | undefined;
};

export function T3workRecentConversationsSection({
  host,
  props,
}: {
  host: SidecarSectionHost;
  props?: unknown;
}) {
  const sectionProps = props as RecentConversationsSectionProps | undefined;

  return (
    <T3workRecentConversations
      threads={[...(sectionProps?.threads ?? [])]}
      onOpenThread={host.openThread}
      showHeader={false}
      {...(sectionProps?.emptyMessage ? { emptyMessage: sectionProps.emptyMessage } : {})}
      {...(sectionProps?.searchPlaceholder
        ? { searchPlaceholder: sectionProps.searchPlaceholder }
        : {})}
      {...(sectionProps?.showSearch !== undefined ? { showSearch: sectionProps.showSearch } : {})}
      {...(sectionProps?.showCount !== undefined ? { showCount: sectionProps.showCount } : {})}
    />
  );
}
