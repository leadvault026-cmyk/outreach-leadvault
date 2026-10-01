"use client";

import { ChevronRight } from "lucide-react";
import { usePathname } from "next/navigation";
import { activeNavKey, navItemByKey } from "@/config/navigation";
import type { WorkspaceRole } from "@/domain/enums";
import type { WorkspaceSummary } from "@/server/workspace";
import { MobileNav } from "./mobile-nav";
import { NavSearch } from "./nav-search";
import { UserMenu } from "./user-menu";

const SUBSECTION_LABELS: Record<string, string> = {
  workspace: "Workspace",
  team: "Team",
  compliance: "Compliance",
  "audit-log": "Audit log",
  sending: "Sending",
  integrations: "Integrations",
  notifications: "Notifications",
  security: "Security",
};

export function TopBar({
  workspace,
  workspaces,
  user,
  environmentLabel,
}: {
  workspace: WorkspaceSummary;
  workspaces: WorkspaceSummary[];
  user: { fullName: string | null; email: string | null; role: WorkspaceRole };
  environmentLabel: string | null;
}) {
  const pathname = usePathname();
  const key = activeNavKey(pathname);
  const section = key === "profile" ? "Profile" : (navItemByKey(key ?? "")?.label ?? "");
  const sub = pathname.split("/")[4];
  const subLabel = sub ? SUBSECTION_LABELS[sub] : undefined;

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-6">
      <MobileNav workspace={workspace} workspaces={workspaces} />

      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-1.5 text-sm">
          <li className="hidden truncate text-muted-foreground md:block">{workspace.name}</li>
          {section ? (
            <>
              <li aria-hidden className="hidden text-muted-foreground md:block">
                <ChevronRight className="size-3.5" />
              </li>
              <li className={subLabel ? "truncate text-muted-foreground" : "truncate font-medium"}>
                {section}
              </li>
            </>
          ) : null}
          {subLabel ? (
            <>
              <li aria-hidden className="text-muted-foreground">
                <ChevronRight className="size-3.5" />
              </li>
              <li className="truncate font-medium" aria-current="page">
                {subLabel}
              </li>
            </>
          ) : null}
        </ol>
      </nav>

      <div className="flex items-center gap-2">
        <NavSearch workspaceSlug={workspace.slug} />
        {environmentLabel ? (
          <span
            className="hidden rounded-md border border-warning/30 bg-warning-soft px-2 py-1 text-[11px] font-semibold tracking-wide text-warning uppercase lg:inline"
            title="This is not a production environment. No email can be sent."
          >
            {environmentLabel}
          </span>
        ) : null}
        <UserMenu
          workspaceSlug={workspace.slug}
          fullName={user.fullName}
          email={user.email}
          role={user.role}
        />
      </div>
    </header>
  );
}
