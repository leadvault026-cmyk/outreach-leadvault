import type { Metadata } from "next";
import { CampaignSettingsForm } from "@/components/campaigns/settings-form";
import { PageHeader } from "@/components/page-header";
import { PermissionDenied } from "@/components/states/status-states";
import { can } from "@/domain/permissions";
import { campaignFormOptions } from "@/server/queries/campaign-form";
import { getPageContext } from "@/server/page-context";

export const metadata: Metadata = { title: "New campaign" };

export default async function NewCampaignPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/campaigns/new">) {
  const ctx = await getPageContext(params);
  if (!ctx) return null;
  if (!can(ctx.role, "campaigns.manage"))
    return (
      <PermissionDenied requirement="Creating campaigns requires the Operator role or higher." />
    );
  const options = await campaignFormOptions(ctx);
  const sp = await searchParams;
  const audienceId = typeof sp.audience === "string" ? sp.audience : "";
  const usable = options.mailboxes.find((m) => m.usable);
  return (
    <>
      <PageHeader
        title="New campaign"
        description="Step 1 of 3: choose who to contact and when. Next you write the email sequence, then preview and launch."
      />
      <CampaignSettingsForm
        workspaceSlug={ctx.workspace.slug}
        campaignId={null}
        editable
        audiences={options.audiences}
        mailboxes={options.mailboxes}
        timezones={options.timezones}
        defaults={{
          name: "",
          description: "",
          audienceId: options.audiences.some((a) => a.id === audienceId) ? audienceId : "",
          mailboxId: usable?.id ?? "",
          timezone: ctx.workspace.defaultTimezone,
          startMode: "launch",
          startDate: "",
          startTime: "09:00",
          anyTime: false,
          sendDays: [1, 2, 3, 4, 5],
          windowStart: "08:00",
          windowEnd: "17:00",
          dailyLimit: "",
        }}
      />
    </>
  );
}
