import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { DefinitionList, NotSet } from "@/components/settings/definition-list";
import { InlineAlert } from "@/components/states/inline-alert";
import { StatusBadge } from "@/components/status-badge";
import { can } from "@/domain/permissions";
import { formatDateTime } from "@/lib/format";
import { getPageContext } from "@/server/page-context";
import { loadWorkspaceDetails } from "@/server/queries/settings";

export const metadata: Metadata = { title: "Workspace settings" };

export default async function WorkspaceSettingsPage({
  params,
}: PageProps<"/w/[workspaceSlug]/settings/workspace">) {
  const ctx = await getPageContext(params);
  if (!ctx) return null;
  const ws = await loadWorkspaceDetails(ctx);
  if (!ws) return null;

  return (
    <>
      <PageHeader
        title="Workspace"
        description="One workspace corresponds to one client. All prospects, campaigns, mailboxes and suppressions belong to a workspace."
      />
      <div className="max-w-3xl space-y-4">
        {!ws.compliancePostalAddress ? (
          <InlineAlert tone="warning" title="Compliance postal address not set">
            Campaigns to jurisdictions that require a postal address cannot launch until one is set.
          </InlineAlert>
        ) : null}
        <DefinitionList
          items={[
            { term: "Name", value: ws.name },
            { term: "Workspace URL", value: <code className="text-[13px]">/w/{ws.slug}</code> },
            {
              term: "Type",
              value: ws.kind === "internal" ? "LeadVault internal" : "Client workspace",
            },
            { term: "Default time zone", value: ws.defaultTimezone },
            { term: "Sender country", value: ws.senderCountryCode ?? <NotSet /> },
            {
              term: "Compliance postal address",
              value: ws.compliancePostalAddress ?? <NotSet />,
            },
            {
              term: "Data",
              value: ws.isDemo ? (
                <StatusBadge status="demo" tone="info" label="Demo — fictional data" />
              ) : (
                "Live"
              ),
            },
            { term: "Created", value: formatDateTime(ws.createdAt, ws.defaultTimezone) },
          ]}
        />
        <p className="text-muted-foreground text-[13px]">
          {can(ctx.role, "workspace.settings")
            ? "Editing workspace details becomes available with workspace administration in a later phase."
            : "Only workspace Owners can change these settings."}
        </p>
      </div>
    </>
  );
}
