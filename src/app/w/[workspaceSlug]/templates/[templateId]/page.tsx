import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { TemplateForm } from "@/components/templates/template-form";
import { withUserContext } from "@/db/client";
import { can } from "@/domain/permissions";
import { isUuid } from "@/lib/ids";
import { getPageContext } from "@/server/page-context";
import { getTemplate } from "@/services/template-service";

export const metadata: Metadata = { title: "Template" };

export default async function TemplatePage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/templates/[templateId]">) {
  const ctx = await getPageContext(params);
  if (!ctx) return null;
  const { templateId } = await params;
  if (!isUuid(templateId)) notFound();
  const t = await withUserContext(ctx.user.userId, (tx) =>
    getTemplate(tx, ctx.workspace.id, templateId),
  );
  if (!t) notFound();
  const sp = await searchParams;
  return (
    <>
      <Link
        href={`/w/${ctx.workspace.slug}/templates`}
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" /> Templates
      </Link>
      <PageHeader title={t.name} />
      <TemplateForm
        workspaceSlug={ctx.workspace.slug}
        templateId={t.id}
        canEdit={can(ctx.role, "templates.manage")}
        saved={sp.saved === "1"}
        initial={{ name: t.name, subject: t.subject, body: t.body }}
      />
    </>
  );
}
