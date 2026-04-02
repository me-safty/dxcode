import type { CSSProperties, ReactNode } from "react";
import { useCallback } from "react";
import { Sidebar, SidebarProvider, SidebarRail } from "./ui/sidebar";

type WorkspaceRightSidebarProps = {
  children: ReactNode;
  defaultWidth: string;
  minWidth: number;
  onOpenChange?: (open: boolean) => void;
  open: boolean;
  storageKey: string;
};

const COMPOSER_COMPACT_MIN_LEFT_CONTROLS_WIDTH_PX = 208;

function shouldAcceptWorkspaceSidebarWidth({
  nextWidth,
  wrapper,
}: {
  nextWidth: number;
  wrapper: HTMLElement;
}) {
  const composerForm = document.querySelector<HTMLElement>("[data-chat-composer-form='true']");
  if (!composerForm) return true;
  const composerViewport = composerForm.parentElement;
  if (!composerViewport) return true;
  const previousSidebarWidth = wrapper.style.getPropertyValue("--sidebar-width");
  wrapper.style.setProperty("--sidebar-width", `${nextWidth}px`);

  const viewportStyle = window.getComputedStyle(composerViewport);
  const viewportPaddingLeft = Number.parseFloat(viewportStyle.paddingLeft) || 0;
  const viewportPaddingRight = Number.parseFloat(viewportStyle.paddingRight) || 0;
  const viewportContentWidth = Math.max(
    0,
    composerViewport.clientWidth - viewportPaddingLeft - viewportPaddingRight,
  );
  const formRect = composerForm.getBoundingClientRect();
  const composerFooter = composerForm.querySelector<HTMLElement>(
    "[data-chat-composer-footer='true']",
  );
  const composerRightActions = composerForm.querySelector<HTMLElement>(
    "[data-chat-composer-actions='right']",
  );
  const composerRightActionsWidth = composerRightActions?.getBoundingClientRect().width ?? 0;
  const composerFooterGap = composerFooter
    ? Number.parseFloat(window.getComputedStyle(composerFooter).columnGap) ||
      Number.parseFloat(window.getComputedStyle(composerFooter).gap) ||
      0
    : 0;
  const minimumComposerWidth =
    COMPOSER_COMPACT_MIN_LEFT_CONTROLS_WIDTH_PX + composerRightActionsWidth + composerFooterGap;
  const hasComposerOverflow = composerForm.scrollWidth > composerForm.clientWidth + 0.5;
  const overflowsViewport = formRect.width > viewportContentWidth + 0.5;
  const violatesMinimumComposerWidth = composerForm.clientWidth + 0.5 < minimumComposerWidth;

  if (previousSidebarWidth.length > 0) {
    wrapper.style.setProperty("--sidebar-width", previousSidebarWidth);
  } else {
    wrapper.style.removeProperty("--sidebar-width");
  }

  return !hasComposerOverflow && !overflowsViewport && !violatesMinimumComposerWidth;
}

export function WorkspaceRightSidebar({
  children,
  defaultWidth,
  minWidth,
  onOpenChange,
  open,
  storageKey,
}: WorkspaceRightSidebarProps) {
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      onOpenChange?.(nextOpen);
    },
    [onOpenChange],
  );

  return (
    <SidebarProvider
      defaultOpen={false}
      open={open}
      onOpenChange={handleOpenChange}
      className="w-auto min-h-0 flex-none bg-transparent"
      style={{ "--sidebar-width": defaultWidth } as CSSProperties}
    >
      <Sidebar
        side="right"
        collapsible="offcanvas"
        desktopMode="inline"
        className="border-l border-border bg-card text-foreground"
        resizable={{
          minWidth,
          shouldAcceptWidth: shouldAcceptWorkspaceSidebarWidth,
          storageKey,
        }}
      >
        {children}
        <SidebarRail />
      </Sidebar>
    </SidebarProvider>
  );
}
