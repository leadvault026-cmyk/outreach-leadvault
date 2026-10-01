import "server-only";
import { and, count, countDistinct, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { withUserContext } from "@/db/client";
import {
  campaignRecipients,
  campaigns,
  mailboxes,
  messageEvents,
  messages,
  prospects,
  replies,
  replyThreads,
} from "@/db/schema";
import type { WorkspaceContext } from "../workspace";

const DAY = 86_400_000;

export type DashboardData = Awaited<ReturnType<typeof loadDashboard>>;

/**
 * Dashboard read model. Runs under RLS (withUserContext) and is additionally scoped by
 * workspace_id in every query. Phase 1 data comes from clearly-labelled demo seed records.
 */
export async function loadDashboard(ctx: WorkspaceContext, now = new Date()) {
  const ws = ctx.workspace.id;
  const tz = ctx.workspace.defaultTimezone;
  const since30 = new Date(now.getTime() - 30 * DAY);
  const since14 = new Date(now.getTime() - 13 * DAY);

  return withUserContext(ctx.user.userId, async (tx) => {
    const one = async (q: Promise<Array<{ n: number }>>) => Number((await q)[0]?.n ?? 0);

    const kpis = {
      activeCampaigns: await one(
        tx
          .select({ n: count() })
          .from(campaigns)
          .where(and(eq(campaigns.workspaceId, ws), eq(campaigns.status, "ACTIVE"))),
      ),
      prospectsInCampaigns: await one(
        tx
          .select({ n: countDistinct(campaignRecipients.prospectId) })
          .from(campaignRecipients)
          .where(
            and(
              eq(campaignRecipients.workspaceId, ws),
              inArray(campaignRecipients.status, ["QUEUED", "SCHEDULED", "SENDING"]),
            ),
          ),
      ),
      sent: await one(
        tx
          .select({ n: count() })
          .from(messages)
          .where(
            and(eq(messages.workspaceId, ws), eq(messages.status, "SENT"), gte(messages.sentAt, since30)),
          ),
      ),
      replies: await one(
        tx
          .select({ n: count() })
          .from(replies)
          .where(
            and(
              eq(replies.workspaceId, ws),
              eq(replies.kind, "human_reply"),
              gte(replies.receivedAt, since30),
            ),
          ),
      ),
      positiveReplies: await one(
        tx
          .select({ n: count() })
          .from(replyThreads)
          .where(
            and(
              eq(replyThreads.workspaceId, ws),
              eq(replyThreads.classification, "INTERESTED"),
              gte(replyThreads.lastMessageAt, since30),
            ),
          ),
      ),
      bounces: await one(
        tx
          .select({ n: count() })
          .from(messageEvents)
          .where(
            and(
              eq(messageEvents.workspaceId, ws),
              eq(messageEvents.eventType, "hard_bounce"),
              gte(messageEvents.occurredAt, since30),
            ),
          ),
      ),
      scheduled: await one(
        tx
          .select({ n: count() })
          .from(campaignRecipients)
          .where(and(eq(campaignRecipients.workspaceId, ws), eq(campaignRecipients.status, "SCHEDULED"))),
      ),
    };

    const sentByDay = await tx
      .select({
        day: sql<string>`to_char((${messages.sentAt} at time zone ${tz})::date, 'YYYY-MM-DD')`,
        n: count(),
      })
      .from(messages)
      .where(and(eq(messages.workspaceId, ws), eq(messages.status, "SENT"), gte(messages.sentAt, since14)))
      .groupBy(sql`1`);

    const repliesByDay = await tx
      .select({
        day: sql<string>`to_char((${replies.receivedAt} at time zone ${tz})::date, 'YYYY-MM-DD')`,
        n: count(),
      })
      .from(replies)
      .where(
        and(
          eq(replies.workspaceId, ws),
          eq(replies.kind, "human_reply"),
          gte(replies.receivedAt, since14),
        ),
      )
      .groupBy(sql`1`);

    const recentCampaigns = await tx
      .select({
        id: campaigns.id,
        name: campaigns.name,
        status: campaigns.status,
        launchedAt: campaigns.launchedAt,
        recipients: sql<number>`(select count(*)::int from app.campaign_recipients r where r.campaign_id = "app"."campaigns"."id")`,
        sent: sql<number>`(select count(*)::int from app.messages m where m.campaign_id = "app"."campaigns"."id" and m.status = 'SENT')`,
        replies: sql<number>`(select count(*)::int from app.reply_threads t where t.campaign_id = "app"."campaigns"."id")`,
      })
      .from(campaigns)
      .where(eq(campaigns.workspaceId, ws))
      .orderBy(desc(campaigns.createdAt))
      .limit(5);

    const recentReplies = await tx
      .select({
        id: replies.id,
        fromName: replies.fromName,
        fromEmail: replies.fromEmail,
        snippet: replies.snippet,
        receivedAt: replies.receivedAt,
        classification: replyThreads.classification,
        company: prospects.companyName,
        campaign: campaigns.name,
      })
      .from(replies)
      .innerJoin(replyThreads, eq(replyThreads.id, replies.replyThreadId))
      .leftJoin(prospects, eq(prospects.id, replyThreads.prospectId))
      .leftJoin(campaigns, eq(campaigns.id, replyThreads.campaignId))
      .where(and(eq(replies.workspaceId, ws), eq(replies.kind, "human_reply")))
      .orderBy(desc(replies.receivedAt))
      .limit(6);

    const startOfToday = new Date(now.getTime() - (now.getTime() % DAY));
    const mailboxHealth = await tx
      .select({
        id: mailboxes.id,
        emailAddress: mailboxes.emailAddress,
        status: mailboxes.status,
        statusReason: mailboxes.statusReason,
        warmupStatus: mailboxes.warmupStatus,
        dailySendLimit: mailboxes.dailySendLimit,
        sentToday: sql<number>`(select count(*)::int from app.messages m where m.mailbox_id = "app"."mailboxes"."id" and m.status = 'SENT' and m.sent_at >= ${startOfToday.toISOString()}::timestamptz)`,
      })
      .from(mailboxes)
      .where(eq(mailboxes.workspaceId, ws))
      .orderBy(mailboxes.emailAddress);

    const pausedCampaigns = await tx
      .select({ id: campaigns.id, name: campaigns.name, reason: campaigns.pauseReason })
      .from(campaigns)
      .where(and(eq(campaigns.workspaceId, ws), eq(campaigns.status, "PAUSED")));

    const reviewMessages = await one(
      tx
        .select({ n: count() })
        .from(messages)
        .where(
          and(
            eq(messages.workspaceId, ws),
            inArray(messages.status, ["RECONCILIATION_REQUIRED", "OPERATOR_REVIEW"]),
          ),
        ),
    );

    const unreviewedReplies = await one(
      tx
        .select({ n: count() })
        .from(replyThreads)
        .where(and(eq(replyThreads.workspaceId, ws), eq(replyThreads.classification, "UNREVIEWED"))),
    );

    const activity = await tx
      .select({
        id: messageEvents.id,
        eventType: messageEvents.eventType,
        occurredAt: messageEvents.occurredAt,
        toEmail: messages.toEmail,
        company: prospects.companyName,
        campaign: campaigns.name,
      })
      .from(messageEvents)
      .leftJoin(messages, eq(messages.id, messageEvents.messageId))
      .leftJoin(prospects, eq(prospects.id, messages.prospectId))
      .leftJoin(campaigns, eq(campaigns.id, messages.campaignId))
      .where(eq(messageEvents.workspaceId, ws))
      .orderBy(desc(messageEvents.occurredAt))
      .limit(8);

    // Continuous 14-day series in the workspace time zone.
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const sentMap = new Map(sentByDay.map((r) => [r.day, Number(r.n)]));
    const replyMap = new Map(repliesByDay.map((r) => [r.day, Number(r.n)]));
    const series = Array.from({ length: 14 }, (_, i) => {
      const key = fmt.format(new Date(since14.getTime() + i * DAY));
      return { day: key, sent: sentMap.get(key) ?? 0, replies: replyMap.get(key) ?? 0 };
    });

    return {
      kpis,
      series,
      recentCampaigns,
      recentReplies,
      mailboxHealth,
      attention: {
        pausedCampaigns,
        mailboxesNeedingAttention: mailboxHealth.filter((m) => m.status !== "CONNECTED"),
        reviewMessages,
        unreviewedReplies,
      },
      activity,
      hasAnyData: kpis.sent > 0 || recentCampaigns.length > 0 || mailboxHealth.length > 0,
    };
  });
}
