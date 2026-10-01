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
      <PageHeader title="Settings" description="Workspace configuration, team, compliance and audit." />
      <ul className="grid gap-3 md:grid-cols-2">
        {SETTINGS_SECTIONS.map((s) => {
          const allowed = can(ctx.role, s.capability);
          return (
            <li key={s.key}>
              <Link
                href={`/w/${ctx.workspace.slug}/settings/${s.key}`}
                className="bg-card hover:border-foreground/20 flex h-full items-start gap-3 rounded-lg border p-4 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold">{s.label}</h2>
                    {s.status === "planned" ? (
                      <StatusBadge status="planned" tone="neutral" label="Planned" />
                    ) : null}
                    {!allowed ? (
                      <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                        <Lock aria-hidden className="size-3" /> Admin
                      </span>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground mt-1 text-[13px]">{s.description}</p>
                </div>
                <ChevronRight aria-hidden className="text-muted-foreground mt-0.5 size-4 shrink-0" />
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
