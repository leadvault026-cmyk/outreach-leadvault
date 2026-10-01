"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "@/components/brand/wordmark";
import {
  NAV_SECTIONS,
  SETTINGS_NAV_ITEM,
  activeNavKey,
  workspaceHref,
  type NavItem,
} from "@/config/navigation";
import type { WorkspaceSummary } from "@/server/workspace";
import { cn } from "@/lib/utils";
import { WorkspaceSwitcher } from "./workspace-switcher";

function NavLink({
  item,
  workspaceSlug,
  active,
  onNavigate,
}: {
  item: NavItem;
  workspaceSlug: string;
  active: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={workspaceHref(workspaceSlug, item.segment)}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex h-9 items-center gap-3 rounded-md px-3 text-[13.5px] font-medium transition-colors",
        "focus-visible:outline-sidebar-ring focus-visible:outline-2 focus-visible:outline-offset-0",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-white",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute top-2 bottom-2 left-0 w-[3px] rounded-r-full",
          active ? "bg-sidebar-primary" : "bg-transparent",
        )}
      />
      <Icon className={cn("size-4", active ? "text-sidebar-primary" : "text-sidebar-muted")} />
      {item.label}
    </Link>
  );
}

export function SidebarContent({
  workspace,
  workspaces,
  onNavigate,
}: {
  workspace: WorkspaceSummary;
  workspaces: WorkspaceSummary[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const activeKey = activeNavKey(pathname);

  return (
    <div className="bg-sidebar text-sidebar-foreground flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center px-5">
        <Link
          href={workspaceHref(workspace.slug, "dashboard")}
          onClick={onNavigate}
          className="focus-visible:outline-sidebar-ring rounded-sm"
          aria-label="LeadVault Outreach — dashboard"
        >
          <Wordmark />
        </Link>
      </div>

      <div className="px-3 pb-3">
        <WorkspaceSwitcher current={workspace} workspaces={workspaces} />
      </div>

      <nav aria-label="Primary" className="flex-1 overflow-y-auto px-3 pb-4">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label ?? "root"} className="mt-4 first:mt-1">
            {section.label ? (
              <p className="text-sidebar-muted mb-1.5 px-3 text-[11px] font-semibold tracking-[0.12em] uppercase">
                {section.label}
              </p>
            ) : null}
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.key}>
                  <NavLink
                    item={item}
                    workspaceSlug={workspace.slug}
                    active={activeKey === item.key}
                    onNavigate={onNavigate}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-sidebar-border border-t px-3 py-3">
        <NavLink
          item={SETTINGS_NAV_ITEM}
          workspaceSlug={workspace.slug}
          active={activeKey === SETTINGS_NAV_ITEM.key}
          onNavigate={onNavigate}
        />
      </div>
    </div>
  );
}
