import { FlaskConical } from "lucide-react";
import type { ReactNode } from "react";
import type { WorkspaceRole } from "@/domain/enums";
import type { WorkspaceSummary } from "@/server/workspace";
import { SidebarContent } from "./sidebar-content";
import { TopBar } from "./top-bar";

export function AppShell({
  workspace,
  workspaces,
  user,
  environmentLabel,
  children,
}: {
  workspace: WorkspaceSummary;
  workspaces: WorkspaceSummary[];
  user: { fullName: string | null; email: string | null; role: WorkspaceRole };
  environmentLabel: string | null;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-dvh w-[248px] shrink-0 lg:block">
        <SidebarContent workspace={workspace} workspaces={workspaces} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          workspace={workspace}
          workspaces={workspaces}
          user={user}
          environmentLabel={environmentLabel}
        />
        {workspace.isDemo ? (
          <div
            role="note"
            className="flex items-start gap-2 border-b border-info/20 bg-info-soft px-4 py-2 text-[13px] text-info sm:px-6"
          >
            <FlaskConical aria-hidden className="mt-0.5 size-4 shrink-0" />
            <p>
              <span className="font-semibold">Demo workspace.</span> Every record and figure here is
              fictional development data. It is not production activity.
            </p>
          </div>
        ) : null}
        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 outline-none">
          <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
