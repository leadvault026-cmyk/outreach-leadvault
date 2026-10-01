import { BarChart3 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { withUserContext } from "@/db/client";
import { CAMPAIGN_STATUS_LABELS } from "@/domain/campaigns";
import { percent } from "@/lib/format";
import { getPageContext } from "@/server/page-context";
import { campaignResults, listCampaigns } from "@/services/campaign-service";

export const metadata: Metadata = { title: "Analytics" };

/** Basic campaign results: the operating numbers only, no BI. */
export default async function AnalyticsPage({ params }: PageProps<"/w/[workspaceSlug]/analytics">) {
  const ctx = await getPageContext(params);
  if (!ctx) return null;
  const slug = ctx.workspace.slug;
  const rows = await withUserContext(ctx.user.userId, async (tx) => {
    const list = (await listCampaigns(tx, ctx.workspace.id)).filter((c) => c.status !== "DRAFT");
    const out = [];
    for (const c of list) out.push({ c, r: await campaignResults(tx, ctx.workspace.id, c.id) });
    return out;
  });
  const th = "px-2 py-2 text-right font-medium";

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Results per launched campaign. Reply rate is replies ÷ prospects emailed. “Delivered” and open rates are not shown: they cannot be measured reliably."
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="No results yet"
          description="Results appear once a campaign has been launched."
          className="bg-card"
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[760px] text-sm">
            <caption className="sr-only">Campaign results</caption>
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                <th scope="col" className="px-4 py-2 font-medium">
                  Campaign
                </th>
                <th scope="col" className={th}>
                  Recipients
                </th>
                <th scope="col" className={th}>
                  Sent
                </th>
                <th scope="col" className={th}>
                  Replied
                </th>
                <th scope="col" className={th}>
                  Reply rate
                </th>
                <th scope="col" className={th}>
                  Positive
                </th>
                <th scope="col" className={th}>
                  Bounced
                </th>
                <th scope="col" className={th}>
                  Unsubscribed
                </th>
                <th scope="col" className={th}>
                  Suppressed / stopped
                </th>
                <th scope="col" className={`${th} pr-4`}>
                  Remaining
                </th>
              </tr>
            </thead>
            <tbody className="tabular">
              {rows.map(({ c, r }) => {
                const st = CAMPAIGN_STATUS_LABELS[c.status];
                return (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/w/${slug}/campaigns/${c.id}`}
                        className="font-medium hover:underline"
                      >
                        {c.name}
                      </Link>
                      <div className="mt-0.5">
                        <StatusBadge status={c.status} label={st?.label} tone={st?.tone} />
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-right">{r.recipients}</td>
                    <td className="px-2 py-2.5 text-right">{r.sent}</td>
                    <td className="px-2 py-2.5 text-right">{r.replied}</td>
                    <td className="px-2 py-2.5 text-right">{percent(r.replied, r.contacted)}</td>
                    <td className="px-2 py-2.5 text-right">{r.positive}</td>
                    <td className="px-2 py-2.5 text-right">{r.bounced}</td>
                    <td className="px-2 py-2.5 text-right">{r.unsubscribed}</td>
                    <td className="px-2 py-2.5 text-right">{r.suppressed + r.stopped}</td>
                    <td className="px-2 py-2.5 pr-4 text-right">{r.remaining}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
