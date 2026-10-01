import type { Metadata } from "next";
import { ImportSteps } from "@/components/imports/import-steps";
import { UploadForm } from "@/components/imports/upload-form";
import { PageHeader } from "@/components/page-header";
import { PermissionDenied } from "@/components/states/status-states";
import { can } from "@/domain/permissions";
import { getPageContext } from "@/server/page-context";

export const metadata: Metadata = { title: "New import" };

export default async function NewImportPage({
  params,
}: PageProps<"/w/[workspaceSlug]/imports/new">) {
  const ctx = await getPageContext(params);
  if (!ctx) return null;
  if (!can(ctx.role, "prospects.manage")) {
    return (
      <PermissionDenied requirement="Importing prospects requires the Operator role or higher." />
    );
  }
  return (
    <>
      <PageHeader
        title="New import"
        description="Upload a CSV of approved prospect intelligence. The LeadVault delivery layout is recognized automatically; any other layout can be mapped."
      />
      <ImportSteps current="upload" reachable={[]} hrefFor={() => null} />
      <UploadForm workspaceSlug={ctx.workspace.slug} />
    </>
  );
}
