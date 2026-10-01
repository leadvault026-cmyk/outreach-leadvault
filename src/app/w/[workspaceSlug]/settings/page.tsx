import { ChevronRight, Lock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { SETTINGS_SECTIONS } from "@/config/settings";
import { can } from "@/domain/permissions";
import { getPageContext } from "@/server/page-context";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ params }: PageProps<"/w/[workspaceSlug]/settings">) {
  const ctx = await getPageContext(params);
  if (!ctx) return null;

  return (
    <>
      <PageHeader
        title="Settings"
        description="Workspace configuration, team, compliance and audit."
      />
      <ul className="grid gap-3 md:grid-cols-2">
        {SETTINGS_SECTIONS.map((s) => {
          const allowed = can(ctx.role, s.capability);
          return (
            <li key={s.key}>
              <Link
                href={`/w/${ctx.workspace.slug}/settings/${s.key}`}
                className="flex h-full items-start gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-foreground/20"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold">{s.label}</h2>
                    {s.status === "planned" ? (
                      <StatusBadge status="planned" tone="neutral" label="Planned" />
                    ) : null}
                    {!allowed ? (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Lock aria-hidden className="size-3" /> Admin
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[13px] text-muted-foreground">{s.description}</p>
                </div>
                <ChevronRight
                  aria-hidden
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
