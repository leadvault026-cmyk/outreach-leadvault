import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Mail,
  MailX,
  Megaphone,
  MessageSquareReply,
  Send,
  ThumbsUp,
  Users,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DailyBarChart } from "@/components/dashboard/daily-bar-chart";
import { KpiTile, Panel } from "@/components/dashboard/kpi-tile";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states/empty-state";
import { InlineAlert } from "@/components/states/inline-alert";
import { DemoBadge, StatusBadge } from "@/components/status-badge";
import { percent, relativeTime } from "@/lib/format";
import { getPageContext } from "@/server/page-context";
import { loadDashboard } from "@/server/queries/dashboard";

export const metadata: Metadata = { title: "Dashboard" };

const EVENT_LABELS: Record<string, string> = {
  sent: "Email sent",
  replied: "Reply received",
  hard_bounce: "Hard bounce",
  soft_bounce: "Soft bounce",
  unsubscribed: "Unsubscribed",
  auto_replied: "Auto-reply",
  blocked: "Blocked",
};

export default async function DashboardPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/dashboard">) {
  const ctx = await getPageContext(params);
  if (!ctx) return null;
  const sp = await searchParams;
  const data = await loadDashboard(ctx);
  const now = new Date();
  const slug = ctx.workspace.slug;
  const { kpis, attention } = data;
  const attentionCount =
    attention.pausedCampaigns.length +
    attention.mailboxesNeedingAttention.length +
    (attention.reviewMessages > 0 ? 1 : 0);

  return (
    <>
      <PageHeader
        title="Dashboard"
        badge={ctx.workspace.isDemo ? <DemoBadge /> : null}
        description="Campaign activity, replies and mailbox health for this workspace. Figures cover the last 30 days unless noted."
      />

      {sp.password_updated ? (
        <InlineAlert tone="success" className="mb-6">
          Your password has been updated.
        </InlineAlert>
      ) : null}

      {!data.hasAnyData ? (
        <EmptyState
          icon={Megaphone}
          title="No outreach activity yet"
          description="Once prospects are imported, mailboxes connected and campaigns launched, sending activity, replies and mailbox health appear here."
          className="bg-card"
        />
      ) : (
        <div className="space-y-6">
          <section aria-label="Key figures" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile label="Active campaigns" value={kpis.activeCampaigns} icon={Megaphone} />
            <KpiTile
              label="Prospects in campaigns"
              value={kpis.prospectsInCampaigns}
              hint="Queued, scheduled or sending"
              icon={Users}
            />
            <KpiTile label="Emails sent" value={kpis.sent} hint="Last 30 days" icon={Send} />
            <KpiTile
              label="Replies"
              value={kpis.replies}
              hint={`Reply rate ${percent(kpis.replies, kpis.sent)}`}
              icon={MessageSquareReply}
            />
            <KpiTile
              label="Positive replies"
              value={kpis.positiveReplies}
              hint={`${percent(kpis.positiveReplies, kpis.sent)} of sent`}
              icon={ThumbsUp}
            />
            <KpiTile
              label="Bounces"
              value={kpis.bounces}
              hint={`Hard bounces · ${percent(kpis.bounces, kpis.sent)} of sent`}
              icon={MailX}
            />
            <KpiTile
              label="Scheduled"
              value={kpis.scheduled}
              hint="Recipients awaiting next step"
              icon={CalendarClock}
            />
            <KpiTile
              label="Needs attention"
              value={attentionCount}
              hint="Paused campaigns, mailboxes, sends"
              icon={AlertTriangle}
            />
          </section>

          <div className="grid gap-6 xl:grid-cols-3">
            <Panel
              title="Sending activity"
              description="Last 14 days, in the workspace time zone"
              className="xl:col-span-2"
            >
              <div className="grid gap-6 md:grid-cols-2">
                <DailyBarChart
                  title="Emails sent"
                  unit="sent"
                  color="var(--chart-1)"
                  data={data.series.map((p) => ({ day: p.day, value: p.sent }))}
                />
                <DailyBarChart
                  title="Replies received"
                  unit="replies"
                  color="var(--chart-2)"
                  data={data.series.map((p) => ({ day: p.day, value: p.replies }))}
                />
              </div>
            </Panel>

            <Panel title="Campaigns requiring attention" description="Items an operator should review">
              {attentionCount === 0 && attention.unreviewedReplies === 0 ? (
                <p className="text-muted-foreground flex items-center gap-2 text-sm">
                  <CheckCircle2 aria-hidden className="text-success size-4" /> Nothing needs attention.
                </p>
              ) : (
                <ul className="space-y-3">
                  {attention.pausedCampaigns.map((c) => (
                    <li key={c.id} className="flex items-start gap-3">
                      <StatusBadge status="PAUSED" />
                      <div className="min-w-0 text-sm">
                        <p className="truncate font-medium">{c.name}</p>
                        <p className="text-muted-foreground text-xs">{c.reason ?? "Paused by an operator"}</p>
                      </div>
                    </li>
                  ))}
                  {attention.mailboxesNeedingAttention.map((m) => (
                    <li key={m.id} className="flex items-start gap-3">
                      <StatusBadge status={m.status} />
                      <div className="min-w-0 text-sm">
                        <p className="truncate font-medium">{m.emailAddress}</p>
                        <p className="text-muted-foreground text-xs">
                          {m.statusReason ?? "Mailbox needs review"}
                        </p>
                      </div>
                    </li>
                  ))}
                  {attention.reviewMessages > 0 ? (
                    <li className="flex items-start gap-3">
                      <StatusBadge status="review" label="Send review" />
                      <p className="text-sm">
                        {attention.reviewMessages} send{attention.reviewMessages === 1 ? "" : "s"} awaiting
                        reconciliation or operator review
                      </p>
                    </li>
                  ) : null}
                  {attention.unreviewedReplies > 0 ? (
                    <li className="flex items-start gap-3">
                      <StatusBadge status="UNREVIEWED" />
                      <p className="text-sm">
                        {attention.unreviewedReplies} repl{attention.unreviewedReplies === 1 ? "y" : "ies"} to
                        classify in the{" "}
                        <Link href={`/w/${slug}/inbox`} className="underline underline-offset-2">
                          Inbox
                        </Link>
                      </p>
                    </li>
                  ) : null}
                </ul>
              )}
            </Panel>
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <Panel
              title="Recent campaigns"
              className="xl:col-span-2"
              action={
                <Link href={`/w/${slug}/campaigns`} className="text-muted-foreground text-xs underline-offset-2 hover:underline">
                  All campaigns
                </Link>
              }
            >
              {data.recentCampaigns.length === 0 ? (
                <p className="text-muted-foreground text-sm">No campaigns yet.</p>
              ) : (
                <>
                  <table className="hidden w-full text-sm md:table">
                    <thead>
                      <tr className="text-muted-foreground border-b text-left text-xs">
                        <th scope="col" className="pb-2 font-medium">Campaign</th>
                        <th scope="col" className="pb-2 font-medium">Status</th>
                        <th scope="col" className="pb-2 text-right font-medium">Recipients</th>
                        <th scope="col" className="pb-2 text-right font-medium">Sent</th>
                        <th scope="col" className="pb-2 text-right font-medium">Replies</th>
                        <th scope="col" className="pb-2 text-right font-medium">Reply rate</th>
                      </tr>
                    </thead>
                    <tbody className="tabular">
                      {data.recentCampaigns.map((c) => (
                        <tr key={c.id} className="border-b last:border-0">
                          <td className="max-w-[260px] truncate py-2.5 pr-3 font-medium">{c.name}</td>
                          <td className="py-2.5 pr-3"><StatusBadge status={c.status} /></td>
                          <td className="py-2.5 text-right">{c.recipients}</td>
                          <td className="py-2.5 text-right">{c.sent}</td>
                          <td className="py-2.5 text-right">{c.replies}</td>
                          <td className="py-2.5 text-right">{percent(c.replies, c.sent)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <ul className="divide-y md:hidden">
                    {data.recentCampaigns.map((c) => (
                      <li key={c.id} className="py-3 first:pt-0 last:pb-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="min-w-0 text-sm font-medium">{c.name}</p>
                          <StatusBadge status={c.status} />
                        </div>
                        <p className="text-muted-foreground tabular mt-1 text-xs">
                          {c.recipients} recipients · {c.sent} sent · {c.replies} replies (
                          {percent(c.replies, c.sent)})
                        </p>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Panel>

            <Panel title="Mailbox health" description="Sent today against each mailbox's daily limit">
              {data.mailboxHealth.length === 0 ? (
                <p className="text-muted-foreground text-sm">No mailboxes connected.</p>
              ) : (
                <ul className="space-y-4">
                  {data.mailboxHealth.map((m) => {
                    const pct = Math.min(100, Math.round((m.sentToday / m.dailySendLimit) * 100));
                    return (
                      <li key={m.id}>
                        <div className="flex items-start justify-between gap-2">
                          <p className="flex min-w-0 items-center gap-2 text-sm">
                            <Mail aria-hidden className="text-muted-foreground size-3.5 shrink-0" />
                            <span className="truncate">{m.emailAddress}</span>
                          </p>
                          <StatusBadge status={m.status} />
                        </div>
                        <div className="mt-2 flex items-center gap-3">
                          <div
                            className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full"
                            role="meter"
                            aria-label={`${m.emailAddress} daily usage`}
                            aria-valuemin={0}
                            aria-valuemax={m.dailySendLimit}
                            aria-valuenow={m.sentToday}
                          >
                            <div className="bg-chart-1 h-full rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-muted-foreground tabular text-xs whitespace-nowrap">
                            {m.sentToday}/{m.dailySendLimit}
                          </span>
                        </div>
                        <p className="text-muted-foreground mt-1 text-xs">
                          Warm-up: {m.warmupStatus === "ready" ? "complete" : m.warmupStatus}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <Panel title="Recent replies">
              {data.recentReplies.length === 0 ? (
                <p className="text-muted-foreground text-sm">No replies yet.</p>
              ) : (
                <ul className="divide-y">
                  {data.recentReplies.map((r) => (
                    <li key={r.id} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {r.fromName ?? r.fromEmail}
                            {r.company ? (
                              <span className="text-muted-foreground font-normal"> · {r.company}</span>
                            ) : null}
                          </p>
                          <p className="text-muted-foreground mt-0.5 line-clamp-1 text-xs">{r.snippet}</p>
                        </div>
                        <StatusBadge status={r.classification} />
                      </div>
                      <p className="text-muted-foreground mt-1 text-xs">
                        {r.campaign ?? "Unmatched"} · {relativeTime(r.receivedAt, now)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Activity" description="Latest message events">
              {data.activity.length === 0 ? (
                <p className="text-muted-foreground text-sm">No activity yet.</p>
              ) : (
                <ol className="space-y-3">
                  {data.activity.map((a) => (
                    <li key={a.id} className="flex items-start gap-3 text-sm">
                      <span aria-hidden className="bg-border mt-1.5 size-2 shrink-0 rounded-full" />
                      <div className="min-w-0">
                        <p>
                          <span className="font-medium">{EVENT_LABELS[a.eventType] ?? a.eventType}</span>
                          {a.company ? <span className="text-muted-foreground"> · {a.company}</span> : null}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {a.campaign ? `${a.campaign} · ` : ""}
                          {relativeTime(a.occurredAt, now)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}
