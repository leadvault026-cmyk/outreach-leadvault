import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { WORKSPACE_ROLES } from "@/domain/enums";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/domain/permissions";
import { getPageContext } from "@/server/page-context";
import { loadTeam } from "@/server/queries/settings";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage({ params }: PageProps<"/w/[workspaceSlug]/settings/team">) {
  const ctx = await getPageContext(params);
  if (!ctx) return null;
  const team = await loadTeam(ctx);

  return (
    <>
      <PageHeader
        title="Team"
        description="People with access to this workspace. Access is invitation-only; there is no public sign-up."
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section aria-labelledby="members-heading" className="min-w-0 rounded-lg border bg-card">
          <h2 id="members-heading" className="border-b px-4 py-3 text-sm font-semibold">
            Members ({team.length})
          </h2>
          <ul className="divide-y">
            {team.map((m) => (
              <li key={m.userId} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {m.fullName ?? m.email ?? "Unnamed member"}
                    {m.userId === ctx.user.userId ? (
                      <span className="font-normal text-muted-foreground"> (you)</span>
                    ) : null}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                </div>
                <StatusBadge status={m.role} tone="neutral" label={ROLE_LABELS[m.role]} />
                {m.status !== "active" ? <StatusBadge status={m.status} tone="warning" /> : null}
              </li>
            ))}
          </ul>
          <p className="border-t px-4 py-3 text-xs text-muted-foreground">
            Inviting members and changing roles becomes available with team administration in a
            later phase. Admins cannot change an Owner&apos;s role.
          </p>
        </section>

        <aside className="rounded-lg border bg-card p-5">
          <h2 className="text-sm font-semibold">Roles</h2>
          <dl className="mt-3 space-y-3">
            {WORKSPACE_ROLES.map((r) => (
              <div key={r}>
                <dt className="text-[13px] font-medium">{ROLE_LABELS[r]}</dt>
                <dd className="text-xs leading-relaxed text-muted-foreground">
                  {ROLE_DESCRIPTIONS[r]}
                </dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>
    </>
  );
}
