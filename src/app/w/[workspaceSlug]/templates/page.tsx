import { FileText, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states/empty-state";
import { Button } from "@/components/ui/button";
import { withUserContext } from "@/db/client";
import { can } from "@/domain/permissions";
import { relativeTime } from "@/lib/format";
import { getPageContext } from "@/server/page-context";
import { listTemplates } from "@/services/template-service";

export const metadata: Metadata = { title: "Templates" };

export default async function TemplatesPage({ params }: PageProps<"/w/[workspaceSlug]/templates">) {
  const ctx = await getPageContext(params);
  if (!ctx) return null;
  const slug = ctx.workspace.slug;
  const list = await withUserContext(ctx.user.userId, (tx) => listTemplates(tx, ctx.workspace.id));
  const canEdit = can(ctx.role, "templates.manage");
  const newButton = canEdit ? (
    <Button asChild>
      <Link href={`/w/${slug}/templates/new`}>
        <Plus /> New template
      </Link>
    </Button>
  ) : null;

  return (
    <>
      <PageHeader
        title="Templates"
        description="Reusable plain-text emails with personalization fields. A campaign copies a template into its sequence, so editing a template never changes a running campaign."
        actions={newButton}
      />
      {list.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No templates yet"
          description="Write your first email: an introduction, a follow-up and a final note are typical."
          className="bg-card"
          action={newButton ?? undefined}
        />
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card" aria-label="Templates">
          {list.map((t) => (
            <li key={t.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
              <div className="min-w-0">
                <Link href={`/w/${slug}/templates/${t.id}`} className="font-medium hover:underline">
                  {t.name}
                </Link>
                <p className="truncate text-sm text-muted-foreground">{t.subject}</p>
                {t.variablesUsed.length ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Uses: {t.variablesUsed.map((v) => `{{${v}}}`).join(", ")}
                  </p>
                ) : null}
              </div>
              <span className="text-xs text-muted-foreground">
                Updated {relativeTime(t.updatedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
