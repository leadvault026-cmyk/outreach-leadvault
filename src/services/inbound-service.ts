import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { AppDatabase } from "@/db/rls";
import {
  campaignOutcomes,
  campaignRecipients,
  campaigns,
  mailboxes,
  messageEvents,
  messages,
  prospectOutreachState,
  replies,
  replyThreads,
  suppressions,
  unsubscribes,
} from "@/db/schema";
import { AUDIT_ACTIONS } from "@/domain/audit";
import { classifyInbound, ownText } from "@/domain/inbound";
import { uuidv7 } from "@/lib/ids";
import type { InboundMessage } from "@/providers/mailbox/contract";
import { writeAudit } from "./audit-writer";
import { refreshEligibility, workspacesWithValue } from "./eligibility-service";
import { haltRecipients, rows } from "./recipient-control";

/**
 * Inbound processing (architecture §15–§17, §19): one pipeline for replies, auto-replies,
 * bounce reports and opt-out replies, whatever transport delivered them (a provider sync, or the
 * fake transport's simulator). Idempotent per (mailbox, provider message id).
 */

type MatchedMessage = typeof messages.$inferSelect;

async function matchMessage(
  db: AppDatabase,
  workspaceId: string,
  mailboxId: string,
  ids: { inReplyTo: string | null; references: readonly string[]; extra: string | null },
  from: string,
): Promise<{
  message: MatchedMessage | null;
  method: "in_reply_to" | "references" | "sender_fallback" | "none";
}> {
  const byId = async (rfc: string | null) => {
    if (!rfc) return null;
    const [m] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.workspaceId, workspaceId), eq(messages.rfcMessageId, rfc)));
    return m ?? null;
  };
  const direct = (await byId(ids.inReplyTo)) ?? (await byId(ids.extra));
  if (direct) return { message: direct, method: "in_reply_to" };
  if (ids.references.length) {
    const [m] = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.workspaceId, workspaceId),
          inArray(messages.rfcMessageId, [...ids.references]),
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(1);
    if (m) return { message: m, method: "references" };
  }
  // Sender fallback: exactly one recipient we sent to from this mailbox in the last 90 days.
  const since = new Date(Date.now() - 90 * 86_400_000);
  const candidates = await db
    .selectDistinct({ recipient: messages.campaignRecipientId })
    .from(messages)
    .where(
      and(
        eq(messages.workspaceId, workspaceId),
        eq(messages.mailboxId, mailboxId),
        eq(messages.toEmail, from.toLowerCase()),
        eq(messages.status, "SENT"),
        gte(messages.sentAt, since),
      ),
    );
  if (candidates.length === 1 && candidates[0]!.recipient) {
    const [m] = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.campaignRecipientId, candidates[0]!.recipient),
          eq(messages.status, "SENT"),
        ),
      )
      .orderBy(desc(messages.sentAt))
      .limit(1);
    if (m) return { message: m, method: "sender_fallback" };
  }
  return { message: null, method: "none" };
}

export type IngestResult = {
  duplicate: boolean;
  kind: string;
  matched: boolean;
  threadId: string | null;
  stopped: boolean;
};

export async function ingestInbound(
  db: AppDatabase,
  mailboxId: string,
  inbound: InboundMessage,
  now = new Date(),
): Promise<IngestResult> {
  const [mb] = await db.select().from(mailboxes).where(eq(mailboxes.id, mailboxId));
  if (!mb) throw new Error("Unknown mailbox");
  const workspaceId = mb.workspaceId;
  const cls = classifyInbound(inbound);
  const fromEmail = inbound.from.toLowerCase();
  const { message, method } = await matchMessage(
    db,
    workspaceId,
    mailboxId,
    {
      inReplyTo: inbound.inReplyTo,
      references: inbound.references,
      extra: cls.kind === "bounce_report" ? cls.bounce.originalMessageId : null,
    },
    cls.kind === "bounce_report" ? (cls.bounce.finalRecipient ?? "") : fromEmail,
  );
  const snippet = ownText(inbound.textBody).replace(/\s+/g, " ").slice(0, 200) || null;

  let followUp: (() => Promise<void>) | null = null;
  const result = await db.transaction(async (tx): Promise<IngestResult> => {
    // Thread: one per conversation (the first message of the sequence identifies it).
    let threadId: string | null = null;
    if (cls.kind !== "bounce_report") {
      const [rec] = message?.campaignRecipientId
        ? await tx
            .select({ first: campaignRecipients.firstMessageRfcId })
            .from(campaignRecipients)
            .where(eq(campaignRecipients.id, message.campaignRecipientId))
        : [];
      const threadKey =
        message?.providerThreadId ??
        rec?.first ??
        message?.rfcMessageId ??
        inbound.messageId ??
        inbound.providerMessageId;
      const classification =
        cls.kind === "auto_reply"
          ? "OUT_OF_OFFICE"
          : cls.kind === "unsubscribe_request"
            ? "UNSUBSCRIBE"
            : "UNREVIEWED";
      const [thread] = await tx
        .insert(replyThreads)
        .values({
          workspaceId,
          mailboxId,
          providerThreadId: threadKey,
          campaignId: message?.campaignId ?? null,
          campaignRecipientId: message?.campaignRecipientId ?? null,
          prospectId: message?.prospectId ?? null,
          subject: inbound.subject,
          classification,
          isUnread: true,
          lastMessageAt: inbound.receivedAt,
        })
        .onConflictDoUpdate({
          target: [replyThreads.mailboxId, replyThreads.providerThreadId],
          set: { lastMessageAt: inbound.receivedAt, isUnread: true, updatedAt: now },
        })
        .returning({ id: replyThreads.id });
      threadId = thread!.id;
    }

    const replyId = uuidv7();
    const inserted = await tx
      .insert(replies)
      .values({
        id: replyId,
        workspaceId,
        mailboxId,
        replyThreadId: threadId,
        providerMessageId: inbound.providerMessageId,
        rfcMessageId: inbound.messageId,
        inReplyTo: inbound.inReplyTo,
        referencesHeader: inbound.references.join(" ") || null,
        fromEmail,
        toEmails: inbound.to,
        subject: inbound.subject,
        snippet,
        bodyText: inbound.textBody,
        receivedAt: inbound.receivedAt,
        kind: cls.kind,
        matchedMessageId: message?.id ?? null,
        matchMethod: method,
        processedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: replies.id });
    if (!inserted.length)
      return {
        duplicate: true,
        kind: cls.kind,
        matched: Boolean(message),
        threadId,
        stopped: false,
      };

    let stopped = false;
    if (cls.kind === "bounce_report") {
      if (message) {
        const type =
          cls.bounce.class === "hard"
            ? "hard_bounce"
            : cls.bounce.class === "soft"
              ? "soft_bounce"
              : "blocked";
        if (cls.bounce.class !== "unknown") {
          await tx
            .insert(messageEvents)
            .values({
              workspaceId,
              messageId: message.id,
              campaignRecipientId: message.campaignRecipientId,
              eventType: type,
              occurredAt: inbound.receivedAt,
              source: "mailbox_sync",
              dedupeKey: `bounce:${message.id}:${inbound.providerMessageId}`,
              data: { status: cls.bounce.status },
            })
            .onConflictDoNothing();
        }
        if (cls.bounce.class === "hard") {
          await tx
            .update(messages)
            .set({ bouncedAt: inbound.receivedAt, bounceType: "hard", updatedAt: now })
            .where(eq(messages.id, message.id));
          if (message.campaignRecipientId) {
            stopped =
              (
                await haltRecipients(
                  tx,
                  { kind: "recipients", ids: [message.campaignRecipientId] },
                  "BOUNCED",
                  "HARD_BOUNCE",
                  now,
                )
              ).length > 0;
          }
          // HARD_BOUNCE suppression is LeadVault-wide by default (architecture §18).
          const email = message.toEmail;
          const [existing] = await tx
            .select({ id: suppressions.id })
            .from(suppressions)
            .where(
              and(
                eq(suppressions.scope, "global"),
                eq(suppressions.valueType, "email"),
                eq(suppressions.valueNormalized, email),
                isNull(suppressions.liftedAt),
              ),
            );
          if (!existing)
            await tx.insert(suppressions).values({
              scope: "global",
              valueType: "email",
              valueNormalized: email,
              reason: "HARD_BOUNCE",
              source: "bounce",
              sourceMessageId: message.id,
              sourceCampaignId: message.campaignId,
              note: `Hard bounce ${cls.bounce.status ?? ""}`.trim(),
            });
          await haltRecipients(
            tx,
            { kind: "email", workspaceId: null, email },
            "SUPPRESSED",
            "SUPPRESSED:HARD_BOUNCE",
            now,
          );
          followUp = async () => {
            for (const ws of await workspacesWithValue(db, "email", email))
              await refreshEligibility(
                db,
                ws,
                { kind: "value", valueType: "email", value: email },
                now,
              );
            await writeAudit(db, {
              actorType: "system",
              action: AUDIT_ACTIONS.bounceRecorded,
              entityType: "message",
              entityId: message.id,
              workspaceId,
              metadata: { class: "hard", status: cls.bounce.status, suppression: "global" },
            });
          };
        } else if (cls.bounce.class === "soft" && message.campaignRecipientId) {
          const [soft] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(messageEvents)
            .where(
              and(
                eq(messageEvents.campaignRecipientId, message.campaignRecipientId),
                eq(messageEvents.eventType, "soft_bounce"),
              ),
            );
          if ((soft?.n ?? 0) >= 3)
            stopped =
              (
                await haltRecipients(
                  tx,
                  { kind: "recipients", ids: [message.campaignRecipientId] },
                  "FAILED",
                  "SOFT_BOUNCE_LIMIT",
                  now,
                )
              ).length > 0;
        }
      }
      return { duplicate: false, kind: cls.kind, matched: Boolean(message), threadId, stopped };
    }

    if (message) {
      await tx
        .insert(messageEvents)
        .values({
          workspaceId,
          messageId: message.id,
          campaignRecipientId: message.campaignRecipientId,
          eventType: cls.kind === "auto_reply" ? "auto_replied" : "replied",
          occurredAt: inbound.receivedAt,
          source: "mailbox_sync",
          dedupeKey: `reply:${replyId}`,
        })
        .onConflictDoNothing();
      const [camp] = message.campaignId
        ? await tx
            .select({ continueOnAutoReply: campaigns.continueOnAutoReply })
            .from(campaigns)
            .where(eq(campaigns.id, message.campaignId))
        : [];
      const stops = cls.kind !== "auto_reply" || camp?.continueOnAutoReply === false;
      if (stops && message.campaignRecipientId) {
        // A reply stops the remaining sequence for this prospect in this campaign.
        stopped =
          (
            await haltRecipients(
              tx,
              { kind: "recipients", ids: [message.campaignRecipientId] },
              "REPLIED",
              "REPLIED",
              now,
            )
          ).length > 0;
        await tx
          .update(campaignRecipients)
          .set({ repliedAt: inbound.receivedAt })
          .where(eq(campaignRecipients.id, message.campaignRecipientId));
      }
      if (message.prospectId && cls.kind !== "auto_reply")
        await tx
          .update(prospectOutreachState)
          .set({ lastReplyAt: inbound.receivedAt })
          .where(eq(prospectOutreachState.prospectId, message.prospectId));
    }
    if (cls.kind === "unsubscribe_request" && message) {
      const msgId = message.id;
      followUp = async () => {
        await processUnsubscribe(db, { messageId: msgId, method: "reply" }, now);
      };
    } else {
      followUp = async () =>
        writeAudit(db, {
          actorType: "system",
          action: AUDIT_ACTIONS.replyReceived,
          entityType: "reply_thread",
          entityId: threadId,
          workspaceId,
          metadata: {
            kind: cls.kind,
            matched: Boolean(message),
            match_method: method,
            stopped_sequence: stopped,
          },
        });
    }
    return { duplicate: false, kind: cls.kind, matched: Boolean(message), threadId, stopped };
  });
  if (followUp) await (followUp as () => Promise<void>)();
  return result;
}

// ───────────────────────────── Unsubscribe ─────────────────────────────

export type UnsubscribeMethod = "one_click_post" | "link_confirm" | "reply" | "manual";

/**
 * Records an unsubscribe for the recipient of `messageId` (architecture §19), idempotently:
 * workspace UNSUBSCRIBE suppression (kept if one is already active), unsubscribe record,
 * every live recipient with that address in the workspace → UNSUBSCRIBED, event, eligibility
 * refresh. Returns false for an unknown message (callers show a generic page).
 */
export async function processUnsubscribe(
  db: AppDatabase,
  input: {
    messageId: string;
    method: UnsubscribeMethod;
    userAgent?: string | null;
    actorUserId?: string | null;
  },
  now = new Date(),
): Promise<{ ok: boolean; alreadyUnsubscribed: boolean }> {
  const [m] = await db.select().from(messages).where(eq(messages.id, input.messageId));
  if (!m) return { ok: false, alreadyUnsubscribed: false };
  const email = m.toEmail.toLowerCase();
  const workspaceId = m.workspaceId;

  const already = await db.transaction(async (tx) => {
    const [active] = await tx
      .select({ id: suppressions.id })
      .from(suppressions)
      .where(
        and(
          eq(suppressions.scope, "workspace"),
          eq(suppressions.workspaceId, workspaceId),
          eq(suppressions.valueType, "email"),
          eq(suppressions.valueNormalized, email),
          isNull(suppressions.liftedAt),
        ),
      );
    let suppressionId = active?.id;
    if (!suppressionId) {
      const [created] = await tx
        .insert(suppressions)
        .values({
          scope: "workspace",
          workspaceId,
          valueType: "email",
          valueNormalized: email,
          reason: "UNSUBSCRIBE",
          source:
            input.method === "reply"
              ? "reply"
              : input.method === "manual"
                ? "manual"
                : "unsubscribe_link",
          sourceMessageId: m.id,
          sourceCampaignId: m.campaignId,
          note: `Unsubscribed (${input.method.replace(/_/g, " ")})`,
          createdBy: input.actorUserId ?? null,
        })
        .returning({ id: suppressions.id });
      suppressionId = created!.id;
    }
    const rec = await tx
      .insert(unsubscribes)
      .values({
        workspaceId,
        emailNormalized: email,
        messageId: m.id,
        campaignId: m.campaignId,
        campaignRecipientId: m.campaignRecipientId,
        method: input.method,
        suppressionId,
        userAgent: input.userAgent?.slice(0, 300) ?? null,
        occurredAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: unsubscribes.id });
    await haltRecipients(
      tx,
      { kind: "email", workspaceId, email },
      "UNSUBSCRIBED",
      "UNSUBSCRIBED",
      now,
      input.actorUserId ?? null,
    );
    await tx
      .insert(messageEvents)
      .values({
        workspaceId,
        messageId: m.id,
        campaignRecipientId: m.campaignRecipientId,
        eventType: "unsubscribed",
        occurredAt: now,
        source: input.method === "manual" ? "user" : "system",
        dedupeKey: `unsubscribed:${m.id}`,
        data: { method: input.method },
      })
      .onConflictDoNothing();
    if (m.campaignRecipientId && m.campaignId && rec.length) {
      await tx
        .update(campaignRecipients)
        .set({ outcome: "UNSUBSCRIBE" })
        .where(eq(campaignRecipients.id, m.campaignRecipientId));
      await tx.insert(campaignOutcomes).values({
        workspaceId,
        campaignRecipientId: m.campaignRecipientId,
        campaignId: m.campaignId,
        outcome: "UNSUBSCRIBE",
        source: "system",
        setBy: input.actorUserId ?? null,
      });
    }
    return Boolean(active) && !rec.length;
  });
  await refreshEligibility(
    db,
    workspaceId,
    { kind: "value", valueType: "email", value: email },
    now,
  );
  if (!already)
    await writeAudit(db, {
      actorType: "system",
      action: AUDIT_ACTIONS.unsubscribeRecorded,
      entityType: "message",
      entityId: m.id,
      workspaceId,
      metadata: { method: input.method },
    });
  return { ok: true, alreadyUnsubscribed: already };
}

// ───────────────────────────── Fake-transport simulators ─────────────────────────────

export type Simulation =
  "reply" | "out_of_office" | "opt_out_reply" | "hard_bounce" | "soft_bounce";

const SIM_TEXT: Record<"reply" | "out_of_office" | "opt_out_reply", string> = {
  reply: "Thanks for reaching out. This sounds relevant — could you send a few times next week?",
  out_of_office: "I'm out of the office until Monday with limited access to email.",
  opt_out_reply: "Please remove me from your list.",
};

/**
 * Builds a realistic inbound message for the latest sent email of a recipient and feeds it
 * through the SAME ingestion pipeline a real mailbox sync would use. Fake transport only.
 */
export async function simulateInbound(
  db: AppDatabase,
  workspaceId: string,
  recipientId: string,
  kind: Simulation,
  now = new Date(),
): Promise<IngestResult | null> {
  const [m] = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.workspaceId, workspaceId),
        eq(messages.campaignRecipientId, recipientId),
        eq(messages.status, "SENT"),
      ),
    )
    .orderBy(desc(messages.stepNumber))
    .limit(1);
  if (!m) return null;
  const id = uuidv7();
  const mailboxDomain = m.fromEmail.split("@")[1] ?? "outreach.example";
  const prospectDomain = m.toEmail.split("@")[1] ?? "prospect.example";
  const inbound: InboundMessage =
    kind === "hard_bounce" || kind === "soft_bounce"
      ? {
          providerMessageId: `sim-${id}`,
          receivedAt: now,
          from: `mailer-daemon@${mailboxDomain}`,
          to: [m.fromEmail],
          subject: "Undelivered Mail Returned to Sender",
          messageId: `<sim-${id}@${mailboxDomain}>`,
          inReplyTo: null,
          references: [],
          headers: { "Content-Type": "multipart/report; report-type=delivery-status" },
          textBody: [
            "This is the mail system. Your message could not be delivered.",
            "",
            `Final-Recipient: rfc822; ${m.toEmail}`,
            "Action: failed",
            `Status: ${kind === "hard_bounce" ? "5.1.1" : "4.2.2"}`,
            `Diagnostic-Code: smtp; ${kind === "hard_bounce" ? "550 5.1.1 User unknown" : "452 4.2.2 Mailbox full"}`,
            "",
            `Message-ID: ${m.rfcMessageId}`,
          ].join("\n"),
        }
      : {
          providerMessageId: `sim-${id}`,
          receivedAt: now,
          from: m.toEmail,
          to: [m.fromEmail],
          subject:
            kind === "out_of_office"
              ? `Automatic reply: ${m.subject}`
              : `Re: ${m.subject.replace(/^re:\s*/i, "")}`,
          messageId: `<sim-${id}@${prospectDomain}>`,
          inReplyTo: m.rfcMessageId,
          references: [m.rfcMessageId],
          headers: kind === "out_of_office" ? { "Auto-Submitted": "auto-replied" } : {},
          textBody: `${SIM_TEXT[kind]}\n\nOn a previous day, ${m.fromEmail} wrote:\n> ${m.bodyText.split("\n")[0] ?? ""}`,
        };
  return ingestInbound(db, m.mailboxId, inbound, now);
}

/** Message used for the recipient's unsubscribe link (latest sent email). */
export async function latestSentMessageId(
  db: AppDatabase,
  workspaceId: string,
  recipientId: string,
) {
  const result = await db.execute(sql`
    select id from app.messages
     where workspace_id = ${workspaceId} and campaign_recipient_id = ${recipientId} and status = 'SENT'
     order by step_number desc limit 1`);
  return rows<{ id: string }>(result)[0]?.id ?? null;
}
