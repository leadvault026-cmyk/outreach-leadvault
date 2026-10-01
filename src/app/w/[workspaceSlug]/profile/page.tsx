import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { DefinitionList, NotSet } from "@/components/settings/definition-list";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/app/(auth)/actions";
import { AUDIT_ACTION_LABELS } from "@/domain/audit";
import { ROLE_LABELS } from "@/domain/permissions";
import { formatDateTime } from "@/lib/format";
import { getPageContext } from "@/server/page-context";
import { getMyProfile } from "@/server/profile";
import { loadMyAccountEvents } from "@/server/queries/settings";
import { listMyWorkspaces } from "@/server/workspace";
import { SendResetLink } from "./send-reset-link";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage({ params }: PageProps<"/w/[workspaceSlug]/profile">) {
  const ctx = await getPageContext(params);
  if (!ctx) return null;
  const [profile, workspaces, events] = await Promise.all([
    getMyProfile(),
    listMyWorkspaces(),
    loadMyAccountEvents(ctx.user.userId),
  ]);
  const tz = ctx.workspace.defaultTimezone;

  return (
    <>
      <PageHeader
        title="Profile"
        description="Your account, workspace access and recent sign-in activity."
      />
      <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
        <section className="space-y-3" aria-labelledby="account-heading">
          <h2 id="account-heading" className="text-sm font-semibold">
            Account
          </h2>
          <DefinitionList
            items={[
              { term: "Name", value: profile.fullName ?? <NotSet /> },
              { term: "Email", value: profile.email ?? <NotSet /> },
              {
                term: "Member since",
                value: profile.createdAt ? formatDateTime(profile.createdAt, tz) : <NotSet />,
              },
            ]}
          />
        </section>

        <section className="space-y-3" aria-labelledby="access-heading">
          <h2 id="access-heading" className="text-sm font-semibold">
            Workspace access
          </h2>
          <ul className="divide-y rounded-lg border bg-card">
            {workspaces.map((w) => (
              <li key={w.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="min-w-0 truncate">{w.name}</span>
                <StatusBadge status={w.role} tone="neutral" label={ROLE_LABELS[w.role]} />
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-3" aria-labelledby="security-heading">
          <h2 id="security-heading" className="text-sm font-semibold">
            Security
          </h2>
          <div className="space-y-4 rounded-lg border bg-card p-4">
            <div>
              <h3 className="text-[13px] font-medium">Password</h3>
              <p className="mt-1 text-[13px] text-muted-foreground">
                For your security, password changes go through a link sent to your email address.
              </p>
              <div className="mt-3">
                <SendResetLink email={profile.email ?? ""} />
              </div>
            </div>
            <div className="border-t pt-4">
              <h3 className="text-[13px] font-medium">Session</h3>
              <form action={signOutAction} className="mt-2">
                <Button type="submit" variant="outline">
                  Sign out
                </Button>
              </form>
            </div>
          </div>
        </section>

        <section className="space-y-3" aria-labelledby="activity-heading">
          <h2 id="activity-heading" className="text-sm font-semibold">
            Recent account activity
          </h2>
          <ul className="divide-y rounded-lg border bg-card">
            {events.length === 0 ? (
              <li className="px-4 py-3 text-sm text-muted-foreground">No recorded activity yet.</li>
            ) : (
              events.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
                >
                  <span>{AUDIT_ACTION_LABELS[e.action] ?? e.action}</span>
                  <time
                    className="tabular text-xs text-muted-foreground"
                    dateTime={e.createdAt.toISOString()}
                  >
                    {formatDateTime(e.createdAt, tz)}
                  </time>
                </li>
              ))
            )}
          </ul>
        </section>
      </div>
    </>
  );
}
