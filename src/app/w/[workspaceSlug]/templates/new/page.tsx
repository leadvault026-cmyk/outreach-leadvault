import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { PermissionDenied } from "@/components/states/status-states";
import { TemplateForm } from "@/components/templates/template-form";
import { can } from "@/domain/permissions";
import { getPageContext } from "@/server/page-context";

export const metadata: Metadata = { title: "New template" };

export default async function NewTemplatePage({
  params,
}: PageProps<"/w/[workspaceSlug]/templates/new">) {
  const ctx = await getPageContext(params);
  if (!ctx) return null;
  if (!can(ctx.role, "templates.manage"))
    return (
      <PermissionDenied requirement="Creating templates requires the Operator role or higher." />
    );
  return (
    <>
      <PageHeader title="New template" />
      <TemplateForm
        workspaceSlug={ctx.workspace.slug}
        templateId={null}
        canEdit
        initial={{
          name: "",
          subject: "Quick question for {{company_name}}",
          body: "Hi {{first_name|there}},\n\n\n\nBest,\n{{sender_name}}",
        }}
      />
    </>
  );
}
