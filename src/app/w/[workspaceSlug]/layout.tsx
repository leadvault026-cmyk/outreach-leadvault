import Link from "next/link";
import { AppShell } from "@/components/shell/app-shell";
import { WorkspaceUnavailable } from "@/components/states/status-states";
import { Button } from "@/components/ui/button";
import { serverEnv } from "@/env/server";
import { getMyProfile } from "@/server/profile";
import { listMyWorkspaces, resolveWorkspace } from "@/server/workspace";

export default async function WorkspaceLayout({
  children,
  params,
}: LayoutProps<"/w/[workspaceSlug]">) {
  const { workspaceSlug } = await params;
  const [resolution, workspaces, profile] = await Promise.all([
    resolveWorkspace(workspaceSlug),
    listMyWorkspaces(),
    getMyProfile(),
  ]);

  if (!resolution.ok) {
    return (
      <main className="px-4">
        <WorkspaceUnavailable
          footer={
            <Button asChild>
              <Link href="/dashboard">Go to my workspaces</Link>
            </Button>
          }
        />
      </main>
    );
  }

  const { workspace, role } = resolution.context;
  const env = serverEnv().APP_ENV;

  return (
    <AppShell
      workspace={workspace}
      workspaces={workspaces}
      user={{ fullName: profile.fullName, email: profile.email, role }}
      environmentLabel={
        env === "production" ? null : env === "local" ? "Local development" : "Staging"
      }
    >
      {children}
    </AppShell>
  );
}
