import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { AppDatabase } from "@/db/rls";
import {
  campaignOutcomes,
  campaignRecipients,
  campaigns,
  messages,
  prospects,
  replies,
  replyThreads,
} from "@/db/schema";
import type { ThreadClassification } from "@/domain/enums";

/**
 * Inbox read model (architecture §16): one row per conversation, newest first. Not a mail
 * client — it shows what came back and lets an operator classify it.
 */
export const INBOX_FILTERS = [
  "all",
  "unread",
  "UNREVIEWED",
  "INTERESTED",
  "NOT_INTERESTED",
  "FOLLOW_UP",
  "OUT_OF_OFFICE",
  "UNSUBSCRIBE",
  "OTHER",
] as const;
export type InboxFilter = (typeof INBOX_FILTERS)[number];

export async function listThreads(
  db: AppDatabase,
  workspaceId: string,
  filter: InboxFilter,
  page: number,
  size = 50,
) {
  const where = and(
    eq(replyThreads.workspaceId, workspaceId),
    filter === "unread"
      ? eq(replyThreads.isUnread, true)
      : filter === "all"
        ? undefined
        : eq(replyThreads.classification, filter),
  );
  const [{ total } = { total: 0 }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(replyThreads)
    .where(where);
  const rows = await db
    .select({
      id: replyThreads.id,
      subject: replyThreads.subject,
      classification: replyThreads.classification,
      isUnread: replyThreads.isUnread,
      lastMessageAt: replyThreads.lastMessageAt,
      companyName: prospects.companyName,
      contactName: prospects.contactName,
      campaignName: campaigns.name,
      latestSnippet: sql<
        string | null
      >`(select r.snippet from app.replies r where r.reply_thread_id = "app"."reply_threads"."id" order by r.received_at desc limit 1)`,
      latestFrom: sql<
        string | null
      >`(select r.from_email from app.replies r where r.reply_thread_id = "app"."reply_threads"."id" order by r.received_at desc limit 1)`,
    })
    .from(replyThreads)
    .leftJoin(prospects, eq(prospects.id, replyThreads.prospectId))
    .leftJoin(campaigns, eq(campaigns.id, replyThreads.campaignId))
    .where(where)
    .orderBy(desc(replyThreads.lastMessageAt))
    .limit(size)
    .offset((page - 1) * size);
  return { total, rows };
}

export async function unreadCount(db: AppDatabase, workspaceId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(replyThreads)
    .where(and(eq(replyThreads.workspaceId, workspaceId), eq(replyThreads.isUnread, true)));
  return row?.n ?? 0;
}

export async function getThread(db: AppDatabase, workspaceId: string, threadId: string) {
  const [t] = await db
    .select({
      thread: replyThreads,
      companyName: prospects.companyName,
      contactName: prospects.contactName,
      prospectEmail: prospects.emailNormalized,
      campaignName: campaigns.name,
      recipientStatus: campaignRecipients.status,
    })
    .from(replyThreads)
    .leftJoin(prospects, eq(prospects.id, replyThreads.prospectId))
    .leftJoin(campaigns, eq(campaigns.id, replyThreads.campaignId))
    .leftJoin(campaignRecipients, eq(campaignRecipients.id, replyThreads.campaignRecipientId))
    .where(and(eq(replyThreads.workspaceId, workspaceId), eq(replyThreads.id, threadId)));
  if (!t) return null;
  const inbound = await db
    .select({
      id: replies.id,
      at: replies.receivedAt,
      from: replies.fromEmail,
      subject: replies.subject,
      body: replies.bodyText,
      kind: replies.kind,
      matchMethod: replies.matchMethod,
    })
    .from(replies)
    .where(and(eq(replies.workspaceId, workspaceId), eq(replies.replyThreadId, threadId)))
    .orderBy(asc(replies.receivedAt));
  const outbound = t.thread.campaignRecipientId
    ? await db
        .select({
          id: messages.id,
          at: messages.sentAt,
          from: messages.fromEmail,
          subject: messages.subject,
          body: messages.bodyText,
          stepNumber: messages.stepNumber,
        })
        .from(messages)
        .where(
          and(
            eq(messages.workspaceId, workspaceId),
            eq(messages.campaignRecipientId, t.thread.campaignRecipientId),
            eq(messages.status, "SENT"),
          ),
        )
        .orderBy(asc(messages.sentAt))
    : [];
  const conversation = [
    ...outbound.map((m) => ({
      ...m,
      at: m.at ?? new Date(0),
      direction: "out" as const,
      kind: "sent",
    })),
    ...inbound.map((r) => ({ ...r, direction: "in" as const, stepNumber: null })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  const latestOutboundId = outbound.at(-1)?.id ?? null;
  return { ...t, conversation, latestOutboundId };
}

export async function markThreadRead(db: AppDatabase, workspaceId: string, threadId: string) {
  await db
    .update(replyThreads)
    .set({ isUnread: false })
    .where(
      and(
        eq(replyThreads.workspaceId, workspaceId),
        eq(replyThreads.id, threadId),
        eq(replyThreads.isUnread, true),
      ),
    );
}

const OUTCOME_FOR: Partial<
  Record<
    ThreadClassification,
    "INTERESTED" | "NOT_INTERESTED" | "FOLLOW_UP" | "OUT_OF_OFFICE" | "UNSUBSCRIBE" | "OTHER"
  >
> = {
  INTERESTED: "INTERESTED",
  NOT_INTERESTED: "NOT_INTERESTED",
  FOLLOW_UP: "FOLLOW_UP",
  OUT_OF_OFFICE: "OUT_OF_OFFICE",
  UNSUBSCRIBE: "UNSUBSCRIBE",
  OTHER: "OTHER",
};

/** Operator classification; also records the campaign outcome for results. */
export async function classifyThread(
  tx: AppDatabase,
  actor: { workspaceId: string; userId: string },
  threadId: string,
  classification: ThreadClassification,
): Promise<{ campaignRecipientId: string | null; campaignId: string | null } | null> {
  const [t] = await tx
    .update(replyThreads)
    .set({
      classification,
      classifiedBy: actor.userId,
      classifiedAt: new Date(),
      isUnread: false,
      updatedAt: new Date(),
    })
    .where(and(eq(replyThreads.workspaceId, actor.workspaceId), eq(replyThreads.id, threadId)))
    .returning({ recipient: replyThreads.campaignRecipientId, campaign: replyThreads.campaignId });
  if (!t) return null;
  const outcome = OUTCOME_FOR[classification];
  if (outcome && t.recipient && t.campaign) {
    await tx
      .update(campaignRecipients)
      .set({ outcome })
      .where(eq(campaignRecipients.id, t.recipient));
    await tx.insert(campaignOutcomes).values({
      workspaceId: actor.workspaceId,
      campaignRecipientId: t.recipient,
      campaignId: t.campaign,
      outcome,
      source: "inbox_classification",
      setBy: actor.userId,
    });
  }
  return { campaignRecipientId: t.recipient, campaignId: t.campaign };
}
