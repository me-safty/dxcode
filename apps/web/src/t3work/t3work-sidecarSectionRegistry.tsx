import { T3workQuickStartsSection } from "~/t3work/t3work-QuickStartsSection";
import { T3workRecentConversationsSection } from "~/t3work/t3work-RecentConversationsSection";
import type { SidecarSectionHost } from "~/t3work/t3work-sidecarSectionHost";

export type T3workSidecarSectionComponent = (props: {
  host: SidecarSectionHost;
  props?: unknown;
}) => React.ReactNode;

const SIDECAR_SECTION_COMPONENTS: Record<string, T3workSidecarSectionComponent> = {
  "quick-starts": T3workQuickStartsSection,
  "recent-conversations": T3workRecentConversationsSection,
};

export function getT3workSidecarSectionComponent(
  component: string,
): T3workSidecarSectionComponent | undefined {
  return SIDECAR_SECTION_COMPONENTS[component];
}
