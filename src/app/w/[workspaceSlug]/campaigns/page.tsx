import { Megaphone, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { TransportNotice } from "@/components/campaigns/system-notices";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { withUserContext } from "@/db/client";
import { CAMPAIGN_STATUS_LABELS } from "@/domain/campaigns";
import { can } from "@/domain/permissions";
import { formatDateTime } from "@/lib/format";
import { getPageContext } from "@/server/page-context";
import { listCampaigns } from "@/services/campaign-service";
import { sendConfig } from "@/services/send-config";

export const metadata: Metadata = { title: "Campaigns" };

export default async function CampaignsPage({ params }: PageProps<"/w/[workspaceSlug]/campaigns">) {
  const ctx = await getPageContext(params);
  if (!ctx) return null;
  const slug = ctx.workspace.slug;
  const tz = ctx.workspace.defaultTimezone;
  const list = await withUserContext(ctx.user.userId, (tx) => listCampaigns(tx, ctx.workspace.id));
  const canManage = can(ctx.role, "campaigns.manage");
  const newButton = canManage ? (
    <Button asChild>
      <Link href={`/w/${slug}/campaigns/new`}>
        <Plus /> New campaign
      </Link>
    </Button>
  ) : null;

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="An audience, a short email sequence and a schedule. Every email is re-checked for eligibility right before it is sent, and replies, bounces and unsubscribes stop the sequence."
        actions={newButton}
      />
      <div className="mb-4">
        <TransportNotice transport={sendConfig().transport} />
      </div>
      {list.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="No campaigns yet"
          description="Create an audience on the Prospects page first, then create a campaign for it."
          className="bg-card"
          action={newButton ?? undefined}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <table className="hidden w-full text-sm md:table">
            <caption className="sr-only">Campaigns</caption>
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                <th scope="col" className="px-4 py-2 font-medium">
                  Campaign
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  Status
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  Audience
                </th>
                <th scope="col" className="px-2 py-2 text-right font-medium">
                  Steps
                </th>
                <th scope="col" className="px-2 py-2 text-right font-medium">
                  Recipients
                </th>
                <th scope="col" className="px-2 py-2 text-right font-medium">
                  Sent
                </th>
                <th scope="col" className="px-2 py-2 text-right font-medium">
                  Replied
                </th>
                <th scope="col" className="px-2 py-2 pr-4 font-medium">
                  Start
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => {
                const st = CAMPAIGN_STATUS_LABELS[c.status];
                return (
                  <tr key={c.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/w/${slug}/campaigns/${c.id}`}
                        className="font-medium hover:underline"
                      >
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-2 py-2.5">
                      <StatusBadge status={c.status} label={st?.label} tone={st?.tone} />
                    </td>
                    <td className="px-2 py-2.5 text-muted-foreground">{c.audienceName ?? "—"}</td>
                    <td className="tabular px-2 py-2.5 text-right">{c.steps}</td>
                    <td className="tabular px-2 py-2.5 text-right">
                      {c.recipients.toLocaleString()}
                    </td>
                    <td className="tabular px-2 py-2.5 text-right">{c.sent.toLocaleString()}</td>
                    <td className="tabular px-2 py-2.5 text-right">{c.replied.toLocaleString()}</td>
                    <td className="px-2 py-2.5 pr-4 text-xs whitespace-nowrap text-muted-foreground">
                      {c.launchedAt
                        ? formatDateTime(c.startAt ?? c.launchedAt, tz)
                        : c.startAt
                          ? `Planned ${formatDateTime(c.startAt, tz)}`
                          : "Not launched"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <ul className="divide-y md:hidden" aria-label="Campaigns">
            {list.map((c) => {
              const st = CAMPAIGN_STATUS_LABELS[c.status];
              return (
                <li key={c.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <Link
                      href={`/w/${slug}/campaigns/${c.id}`}
                      className="min-w-0 font-medium break-words hover:underline"
                    >
                      {c.name}
                    </Link>
                    <StatusBadge status={c.status} label={st?.label} tone={st?.tone} />
                  </div>
                  <p className="tabular mt-1 text-xs text-muted-foreground">
                    {c.recipients} recipients · {c.sent} sent · {c.replied} replied
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}
