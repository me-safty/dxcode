import { Link, useLocation } from "@tanstack/react-router";
import { WorkflowIcon } from "lucide-react";

import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "~/components/ui/sidebar";
import { usePluginCatalog } from "./pluginHost";

export function PluginSidebarNav() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const catalog = usePluginCatalog();
  const navItems = catalog.flatMap((entry) =>
    entry.status.status === "active"
      ? entry.manifest.nav.map((item) => ({
          entry,
          item,
        }))
      : [],
  );

  if (navItems.length === 0) {
    return null;
  }

  return (
    <SidebarGroup className="px-2 py-1">
      <SidebarMenu>
        {navItems.map(({ entry, item }) => {
          const href = `/plugins/${entry.manifest.id}/${item.routeId}`;
          const active = pathname === `/plugins/${entry.manifest.id}` || pathname.startsWith(href);
          return (
            <SidebarMenuItem key={`${entry.manifest.id}:${item.id}`}>
              <SidebarMenuButton
                size="sm"
                isActive={active}
                render={
                  <Link
                    to="/plugins/$pluginId/$routeId"
                    params={{
                      pluginId: entry.manifest.id,
                      routeId: item.routeId,
                    }}
                  />
                }
              >
                <WorkflowIcon className="size-3.5" />
                <span className="flex-1 truncate text-left text-xs">{item.label}</span>
                {item.badgeCount && item.badgeCount > 0 ? (
                  <span className="min-w-4 rounded-sm bg-warning/12 px-1 text-center text-[10px] font-medium text-warning-foreground">
                    {item.badgeCount}
                  </span>
                ) : null}
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
