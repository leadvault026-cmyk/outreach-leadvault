import { and, asc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import type { AppDatabase } from "@/db/rls";
import {
  campaignRecipients,
  campaigns,
  mailboxes,
  messageEvents,
  messages,
  prospectOutreachState,
  prospects,
  sendAttempts,
  sendingIdentities,
  sequenceSteps,
  workspaces,
} from "@/db/schema";
import { isWithinWindow, zonedParts, zonedTimeToUtc } from "@/domain/campaigns";
import { composeMessage } from "@/domain/compose";
import { prospectTokenValues } from "@/domain/personalization";
import { signUnsubscribeToken } from "@/domain/unsubscribe-token";
import { uuidv7 } from "@/lib/ids";
import type { MailboxConnection, MailboxProvider, SendResult } from "@/providers/mailbox/contract";
import { evaluateProspects } from "./eligibility-service";
import { haltRecipients, rows } from "./recipient-control";
import type { SendConfig } from "./send-config";

/**
 * The campaign execution engine run by the worker process (architecture §11–§13). Each function
 * is one loop iteration, safe to run concurrently in several workers: work is claimed with
 * `FOR UPDATE SKIP LOCKED` and state-guarded updates, sends are fenced by lease + attempt number,
 * and the unique (recipient, step) index makes a second message for the same step impossible.
 */

export type ProviderResolver = (mailbox: {
  id: string;
  workspaceId: string;
  isDemoWorkspace: boolean;
}) => MailboxProvider | null;

export type EngineContext = {
  db: AppDatabase;
  config: SendConfig;
  workerId: string;
  resolveProvider: ProviderResolver;
};

const LEASE_MS = 5 * 60_000;
const RETRY_BACKOFF_MIN = [1, 5, 15, 60, 180];
const RECONCILE_SCHEDULE_MIN = [1, 5, 15, 60];
const MAX_ATTEMPTS = 5;

const addMinutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

// ───────────────────────────── Campaign lifecycle ─────────────────────────────

/** SCHEDULED → ACTIVE at start; ACTIVE → COMPLETED when nothing is left to send or resolve. */
export async function runLifecycle(db: AppDatabase, now = new Date()) {
  // Sweep: a not-yet-sent message is only valid while its recipient is SENDING (stop rules
  // applied inside user transactions cannot touch engine-written messages).
  await db.execute(sql`
    update app.messages m set status = 'CANCELLED', updated_at = now()
     where m.status in ('PENDING', 'RETRY_WAIT') and m.kind = 'sequence'
       and not exists (select 1 from app.campaign_recipients r
                        where r.id = m.campaign_recipient_id and r.status = 'SENDING')`);
  const started = await db
    .update(campaigns)
    .set({ status: "ACTIVE", updatedAt: now })
    .where(and(eq(campaigns.status, "SCHEDULED"), lte(campaigns.startAt, now)))
    .returning({ id: campaigns.id });
  const completed = await db
    .update(campaigns)
    .set({ status: "COMPLETED", completedAt: now, updatedAt: now })
    .where(
      and(
        eq(campaigns.status, "ACTIVE"),
        sql`not exists (select 1 from app.campaign_recipients r where r.campaign_id = "app"."campaigns"."id" and r.status in ('QUEUED','SCHEDULED','SENDING'))`,
        sql`not exists (select 1 from app.messages m where m.campaign_id = "app"."campaigns"."id" and m.status in ('PENDING','SENDING','RETRY_WAIT','RECONCILIATION_REQUIRED','OPERATOR_REVIEW'))`,
      ),
    )
    .returning({ id: campaigns.id });
  return { started: started.length, completed: completed.length };
}

// ───────────────────────────── Dispatcher ─────────────────────────────

export type DispatchSummary = {
  queued: number;
  stopped: number;
  waiting: number;
};

/**
 * Turns due recipients of ACTIVE campaigns into PENDING messages, after re-checking the sending
 * window, the campaign's daily limit and — with the authoritative engine — eligibility.
 * Follow-ups are handled before first emails.
 */
export async function dispatchDue(
  ctx: EngineContext,
  now = new Date(),
  batch = 100,
): Promise<DispatchSummary> {
  const summary: DispatchSummary = { queued: 0, stopped: 0, waiting: 0 };
  const secret = ctx.config.unsubscribeSecret;
  if (!secret || secret.length < 32) return summary; // never send without a working opt-out

  await ctx.db.transaction(async (tx) => {
    // Lock due recipients (aliases: Postgres needs unqualified names in FOR UPDATE OF).
    const locked = rows<{ id: string }>(
      await tx.execute(sql`
        select r.id from app.campaign_recipients r
          join app.campaigns c on c.id = r.campaign_id
         where r.status = 'SCHEDULED' and r.next_send_at <= ${now.toISOString()}::timestamptz
           and c.status = 'ACTIVE'
         order by r.next_step desc, r.next_send_at asc
         limit ${batch}
         for update of r skip locked`),
    ).map((r) => r.id);
    if (!locked.length) return;
    const loaded = await tx
      .select({
        recipient: campaignRecipients,
        campaign: {
          id: campaigns.id,
          timezone: campaigns.timezone,
          sendDays: campaigns.sendDays,
          windowStart: campaigns.windowStart,
          windowEnd: campaigns.windowEnd,
          dailyLimit: campaigns.dailyLimit,
          mailboxId: campaigns.mailboxId,
          sendingIdentityId: campaigns.sendingIdentityId,
        },
        workspaceTz: workspaces.defaultTimezone,
        postal: workspaces.compliancePostalAddress,
      })
      .from(campaignRecipients)
      .innerJoin(campaigns, eq(campaigns.id, campaignRecipients.campaignId))
      .innerJoin(workspaces, eq(workspaces.id, campaignRecipients.workspaceId))
      .where(inArray(campaignRecipients.id, locked));
    const due = locked
      .map((id) => loaded.find((d) => d.recipient.id === id))
      .filter((d): d is (typeof loaded)[number] => Boolean(d));
    if (!due.length) return;

    // Group by workspace for one eligibility evaluation per workspace.
    const byWs = new Map<string, typeof due>();
    for (const d of due)
      byWs.set(d.recipient.workspaceId, [...(byWs.get(d.recipient.workspaceId) ?? []), d]);
    const usedToday = new Map<string, number>();

    for (const [workspaceId, list] of byWs) {
      const eligibility = await evaluateProspects(
        tx,
        workspaceId,
        list.map((d) => d.recipient.prospectId),
        now,
      );
      for (const d of list) {
        const r = d.recipient;
        const c = d.campaign;
        const tz = c.timezone ?? d.workspaceTz;
        if (
          !isWithinWindow(now, { days: c.sendDays, start: c.windowStart, end: c.windowEnd }, tz)
        ) {
          summary.waiting++;
          continue;
        }
        if (c.dailyLimit) {
          let used = usedToday.get(c.id);
          if (used === undefined) {
            const dayStart = zonedTimeToUtc(zonedParts(now, tz).date, "00:00", tz);
            const [row] = await tx
              .select({ n: sql<number>`count(*)::int` })
              .from(messages)
              .where(and(eq(messages.campaignId, c.id), gt(messages.createdAt, dayStart)));
            used = row?.n ?? 0;
          }
          if (used >= c.dailyLimit) {
            summary.waiting++;
            continue;
          }
          usedToday.set(c.id, used + 1);
        }

        // Final eligibility re-check: audience membership never means permanent eligibility.
        const e = eligibility.get(r.prospectId);
        if (!e || e.status !== "ELIGIBLE") {
          const reasons: string[] = e?.reasons ?? ["NOT_ELIGIBLE"];
          const status = reasons.includes("UNSUBSCRIBED")
            ? "UNSUBSCRIBED"
            : e?.status === "SUPPRESSED"
              ? "SUPPRESSED"
              : "STOPPED";
          await haltRecipients(
            tx,
            { kind: "recipients", ids: [r.id] },
            status,
            `NOT_ELIGIBLE:${reasons.join(",")}`,
            now,
          );
          summary.stopped++;
          continue;
        }

        const steps = await tx
          .select()
          .from(sequenceSteps)
          .where(and(eq(sequenceSteps.campaignId, c.id), eq(sequenceSteps.enabled, true)))
          .orderBy(asc(sequenceSteps.stepNumber));
        const step = steps.find((s) => s.stepNumber === r.nextStep);
        if (!step || !c.mailboxId) {
          await haltRecipients(
            tx,
            { kind: "recipients", ids: [r.id] },
            "STOPPED",
            "STEP_MISSING",
            now,
          );
          summary.stopped++;
          continue;
        }
        const [p] = await tx.select().from(prospects).where(eq(prospects.id, r.prospectId));
        const [identity] = await tx
          .select({
            fromName: sendingIdentities.fromName,
            fromEmail: sendingIdentities.fromEmail,
            replyTo: sendingIdentities.replyToEmail,
          })
          .from(sendingIdentities)
          .where(
            c.sendingIdentityId
              ? eq(sendingIdentities.id, c.sendingIdentityId)
              : and(
                  eq(sendingIdentities.mailboxId, c.mailboxId),
                  eq(sendingIdentities.isDefault, true),
                ),
          );
        const [mb] = await tx
          .select({ email: mailboxes.emailAddress, name: mailboxes.displayName })
          .from(mailboxes)
          .where(eq(mailboxes.id, c.mailboxId));
        if (!p || !mb) {
          await haltRecipients(
            tx,
            { kind: "recipients", ids: [r.id] },
            "STOPPED",
            "DATA_MISSING",
            now,
          );
          summary.stopped++;
          continue;
        }

        const messageId = uuidv7();
        const token = signUnsubscribeToken(messageId, secret);
        const fromEmail = identity?.fromEmail ?? mb.email;
        const composed = composeMessage({
          step,
          firstStep: steps[0]!,
          values: prospectTokenValues(p, { name: identity?.fromName ?? mb.name }),
          policyFooter: e.jurisdiction.footerTemplate,
          postalAddress: d.postal,
          requiresPostalAddress: e.jurisdiction.requiresPostalAddress,
          unsubscribeUrl: `${ctx.config.unsubscribeBaseUrl}/u/${token}`,
        });
        if (composed.missing.length || composed.missingPostalAddress) {
          await haltRecipients(
            tx,
            { kind: "recipients", ids: [r.id] },
            "STOPPED",
            composed.missing.length
              ? `MISSING_REQUIRED_VARIABLE:${composed.missing.join(",")}`
              : "MISSING_POSTAL_ADDRESS",
            now,
          );
          summary.stopped++;
          continue;
        }

        const domain = fromEmail.split("@")[1] ?? "outreach.invalid";
        const inserted = await tx
          .insert(messages)
          .values({
            id: messageId,
            workspaceId,
            kind: "sequence",
            campaignId: c.id,
            campaignRecipientId: r.id,
            sequenceStepId: step.id,
            stepNumber: step.stepNumber,
            prospectId: r.prospectId,
            mailboxId: c.mailboxId,
            sendingIdentityId: c.sendingIdentityId,
            toEmail: r.emailNormalized,
            fromEmail,
            fromName: identity?.fromName ?? mb.name,
            subject: composed.subject,
            bodyText: composed.body,
            rfcMessageId: `<${messageId}@${domain}>`,
            lvMessageHeader: messageId,
            inReplyTo: composed.isReply ? r.firstMessageRfcId : null,
            referencesHeader: composed.isReply ? r.firstMessageRfcId : null,
            status: "PENDING",
            scheduledFor: now,
          })
          .onConflictDoNothing()
          .returning({ id: messages.id });
        const moved = await tx
          .update(campaignRecipients)
          .set({ status: "SENDING", updatedAt: now })
          .where(and(eq(campaignRecipients.id, r.id), eq(campaignRecipients.status, "SCHEDULED")))
          .returning({ id: campaignRecipients.id });
        if (inserted.length && moved.length) summary.queued++;
      }
    }
  });
  return summary;
}

// ───────────────────────────── Executor ─────────────────────────────

export type ExecuteOutcome =
  | { kind: "idle" }
  | { kind: "disabled"; reason: string }
  | { kind: "skipped"; messageId: string; reason: string }
  | { kind: "sent" | "retry" | "failed" | "ambiguous"; messageId: string };

/**
 * Claims and sends ONE message (at most one in flight per mailbox). Returns what happened, so the
 * worker loop can call it repeatedly until idle.
 */
export async function executeNext(ctx: EngineContext, now = new Date()): Promise<ExecuteOutcome> {
  if (!ctx.config.sendingEnabled) return { kind: "disabled", reason: "SENDING_ENABLED is false" };
  if (ctx.config.transport === "fake" && ctx.config.appEnv === "production")
    return { kind: "disabled", reason: "The fake transport is not allowed in production" };

  type Claim = {
    message: typeof messages.$inferSelect;
    attempt: number;
    provider: MailboxProvider;
    conn: MailboxConnection;
    replyTo: string | null;
    token: string;
  };

  const claim = await ctx.db.transaction(async (tx): Promise<Claim | ExecuteOutcome> => {
    const iso = now.toISOString();
    const [lockedMailbox] = rows<{ id: string }>(
      await tx.execute(sql`
        select mb.id from app.mailboxes mb
         where mb.status = 'CONNECTED' and mb.enabled and mb.next_available_at <= ${iso}::timestamptz
           and exists (select 1 from app.messages m join app.campaigns c on c.id = m.campaign_id
                        where m.mailbox_id = mb.id and c.status = 'ACTIVE'
                          and m.scheduled_for <= ${iso}::timestamptz
                          and (m.status = 'PENDING' or (m.status = 'RETRY_WAIT' and m.next_attempt_at <= ${iso}::timestamptz)))
         order by mb.next_available_at
         limit 1
         for update of mb skip locked`),
    );
    if (!lockedMailbox) return { kind: "idle" };
    const [mb] = await tx
      .select({ mailbox: mailboxes, isDemo: workspaces.isDemo })
      .from(mailboxes)
      .innerJoin(workspaces, eq(workspaces.id, mailboxes.workspaceId))
      .where(eq(mailboxes.id, lockedMailbox.id));
    if (!mb) return { kind: "idle" };
    const mailbox = mb.mailbox;

    const provider = ctx.resolveProvider({
      id: mailbox.id,
      workspaceId: mailbox.workspaceId,
      isDemoWorkspace: mb.isDemo,
    });
    if (!provider)
      return { kind: "disabled", reason: "No email transport is available for this mailbox" };

    const [lockedMessage] = rows<{ id: string }>(
      await tx.execute(sql`
        select m.id from app.messages m
          join app.campaigns c on c.id = m.campaign_id
         where m.mailbox_id = ${mailbox.id} and c.status = 'ACTIVE'
           and m.scheduled_for <= ${iso}::timestamptz
           and (m.status = 'PENDING' or (m.status = 'RETRY_WAIT' and m.next_attempt_at <= ${iso}::timestamptz))
         order by m.scheduled_for
         limit 1
         for update of m skip locked`),
    );
    if (!lockedMessage) return { kind: "idle" };
    const [msg] = await tx
      .select({
        message: messages,
        recipientStatus: campaignRecipients.status,
        campaign: campaigns,
      })
      .from(messages)
      .innerJoin(campaigns, eq(campaigns.id, messages.campaignId))
      .innerJoin(campaignRecipients, eq(campaignRecipients.id, messages.campaignRecipientId))
      .where(eq(messages.id, lockedMessage.id));
    if (!msg) return { kind: "idle" };
    const m = msg.message;

    // ── Final pre-send checks (architecture §13.2) ──
    if (msg.recipientStatus !== "SENDING") {
      await tx
        .update(messages)
        .set({ status: "CANCELLED", updatedAt: now })
        .where(eq(messages.id, m.id));
      return { kind: "skipped", messageId: m.id, reason: "recipient no longer active" };
    }
    const e = (await evaluateProspects(tx, m.workspaceId, [m.prospectId!], now)).get(m.prospectId!);
    if (!e || e.status !== "ELIGIBLE") {
      const reasons: string[] = e?.reasons ?? [];
      await haltRecipients(
        tx,
        { kind: "recipients", ids: [m.campaignRecipientId!] },
        reasons.includes("UNSUBSCRIBED")
          ? "UNSUBSCRIBED"
          : e?.status === "SUPPRESSED"
            ? "SUPPRESSED"
            : "STOPPED",
        `NOT_ELIGIBLE:${reasons.join(",")}`,
        now,
      );
      return { kind: "skipped", messageId: m.id, reason: "not eligible at send time" };
    }
    const c = msg.campaign;
    const tz = c.timezone ?? mailbox.timezone;
    if (!isWithinWindow(now, { days: c.sendDays, start: c.windowStart, end: c.windowEnd }, tz)) {
      await tx
        .update(messages)
        .set({ scheduledFor: addMinutes(now, 15), updatedAt: now })
        .where(eq(messages.id, m.id));
      return { kind: "skipped", messageId: m.id, reason: "outside the sending window" };
    }
    // Mailbox daily cap, enforced atomically (architecture §12).
    const localDay = zonedParts(now, mailbox.timezone).date;
    const usage = await tx.execute(sql`
      insert into app.mailbox_daily_usage (mailbox_id, usage_date, sent_count)
      values (${mailbox.id}, ${localDay}::date, 1)
      on conflict (mailbox_id, usage_date) do update
        set sent_count = app.mailbox_daily_usage.sent_count + 1
        where app.mailbox_daily_usage.sent_count < ${mailbox.dailySendLimit}
      returning sent_count`);
    const usageRows = Array.isArray(usage) ? usage : ((usage as { rows?: unknown[] }).rows ?? []);
    if (!usageRows.length) {
      const tomorrow = zonedTimeToUtc(
        zonedParts(new Date(now.getTime() + 86_400_000), mailbox.timezone).date,
        "00:00",
        mailbox.timezone,
      );
      await tx
        .update(mailboxes)
        .set({ nextAvailableAt: tomorrow })
        .where(eq(mailboxes.id, mailbox.id));
      return { kind: "skipped", messageId: m.id, reason: "mailbox daily limit reached" };
    }

    // ── Claim ──
    const [claimed] = await tx
      .update(messages)
      .set({
        status: "SENDING",
        leaseOwner: ctx.workerId,
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
        attemptCount: sql`${messages.attemptCount} + 1`,
        updatedAt: now,
      })
      .where(and(eq(messages.id, m.id), inArray(messages.status, ["PENDING", "RETRY_WAIT"])))
      .returning({ attempt: messages.attemptCount });
    if (!claimed) return { kind: "skipped", messageId: m.id, reason: "claimed by another worker" };
    await tx.insert(sendAttempts).values({
      messageId: m.id,
      attemptNumber: claimed.attempt,
      workerId: ctx.workerId,
      startedAt: now,
      requestDispatched: true,
    });
    const jitter = 1 + Math.random() * 0.4;
    await tx
      .update(mailboxes)
      .set({
        nextAvailableAt: new Date(now.getTime() + mailbox.minSecondsBetweenSends * 1000 * jitter),
        lastSendAt: now,
      })
      .where(eq(mailboxes.id, mailbox.id));

    const [identity] = m.sendingIdentityId
      ? await tx
          .select({ replyTo: sendingIdentities.replyToEmail })
          .from(sendingIdentities)
          .where(eq(sendingIdentities.id, m.sendingIdentityId))
      : [];
    return {
      message: m,
      attempt: claimed.attempt,
      provider,
      conn: { mailboxId: mailbox.id, emailAddress: mailbox.emailAddress, config: {} },
      replyTo: identity?.replyTo ?? null,
      token: signUnsubscribeToken(m.id, ctx.config.unsubscribeSecret ?? ""),
    };
  });
  if ("kind" in claim) return claim;

  // ── Provider call (outside any transaction) ──
  const m = claim.message;
  let result: SendResult;
  try {
    result = await claim.provider.sendMessage(claim.conn, {
      from: { email: m.fromEmail, name: m.fromName ?? undefined },
      to: m.toEmail,
      replyTo: claim.replyTo ?? undefined,
      subject: m.subject,
      textBody: m.bodyText,
      messageId: m.rfcMessageId,
      lvMessageId: m.lvMessageHeader,
      inReplyTo: m.inReplyTo ?? undefined,
      references: m.referencesHeader ? [m.referencesHeader] : undefined,
      listUnsubscribe: {
        url: `${ctx.config.unsubscribeBaseUrl}/api/unsubscribe/${claim.token}`,
        mailto: `${claim.conn.emailAddress}?subject=unsubscribe`,
        oneClick: true,
      },
    });
  } catch {
    // An exception after dispatch is ambiguous: it may or may not have been sent.
    result = {
      outcome: "ambiguous",
      error: { code: "UNKNOWN", retryable: false, safeMessage: "Unexpected transport error" },
    };
  }
  return recordSendResult(ctx, m, claim.attempt, result, now);
}

/** Fenced write of a send result: only the worker holding this attempt's lease may record it. */
async function recordSendResult(
  ctx: EngineContext,
  m: typeof messages.$inferSelect,
  attempt: number,
  result: SendResult,
  at: Date,
): Promise<ExecuteOutcome> {
  return ctx.db.transaction(async (tx) => {
    const fence = and(
      eq(messages.id, m.id),
      eq(messages.status, "SENDING"),
      eq(messages.attemptCount, attempt),
      eq(messages.leaseOwner, ctx.workerId),
    );
    const attemptWhere = and(
      eq(sendAttempts.messageId, m.id),
      eq(sendAttempts.attemptNumber, attempt),
    );

    if (result.outcome === "accepted") {
      const updated = await tx
        .update(messages)
        .set({
          status: "SENT",
          sentAt: result.acceptedAt,
          providerMessageId: result.providerMessageId,
          providerThreadId: result.providerThreadId ?? null,
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: at,
        })
        .where(fence)
        .returning({ id: messages.id });
      await tx.update(sendAttempts).set({ result: "accepted", finishedAt: at }).where(attemptWhere);
      if (updated.length) await afterSent(tx, m, result.acceptedAt);
      return { kind: "sent", messageId: m.id };
    }

    if (result.outcome === "rejected_not_sent") {
      await tx.execute(sql`
        update app.mailbox_daily_usage set sent_count = greatest(sent_count - 1, 0)
         where mailbox_id = ${m.mailboxId} and usage_date = (select max(usage_date) from app.mailbox_daily_usage where mailbox_id = ${m.mailboxId})`);
      await tx
        .update(sendAttempts)
        .set({
          result: "rejected_not_sent",
          finishedAt: at,
          errorCode: result.error.code,
          providerStatus: result.error.providerStatus ?? null,
          errorDetail: result.error.safeMessage,
        })
        .where(attemptWhere);
      if (result.error.retryable && attempt < MAX_ATTEMPTS) {
        await tx
          .update(messages)
          .set({
            status: "RETRY_WAIT",
            nextAttemptAt: addMinutes(at, RETRY_BACKOFF_MIN[attempt - 1] ?? 180),
            errorCode: result.error.code,
            errorMessage: result.error.safeMessage,
            leaseOwner: null,
            leaseExpiresAt: null,
            updatedAt: at,
          })
          .where(fence);
        return { kind: "retry", messageId: m.id };
      }
      const failed = await tx
        .update(messages)
        .set({
          status: "FAILED",
          failedAt: at,
          errorCode: result.error.code,
          errorMessage: result.error.safeMessage,
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: at,
        })
        .where(fence)
        .returning({ id: messages.id });
      if (failed.length) {
        await tx
          .insert(messageEvents)
          .values({
            workspaceId: m.workspaceId,
            messageId: m.id,
            campaignRecipientId: m.campaignRecipientId,
            eventType: "send_failed",
            occurredAt: at,
            source: "system",
            dedupeKey: `send_failed:${m.id}`,
            data: { code: result.error.code },
          })
          .onConflictDoNothing();
        await haltRecipients(
          tx,
          { kind: "recipients", ids: [m.campaignRecipientId!] },
          "FAILED",
          `SEND_FAILED:${result.error.code}`,
          at,
        );
      }
      return { kind: "failed", messageId: m.id };
    }

    // Ambiguous: NEVER retried automatically. Reconciliation looks for positive evidence.
    await tx
      .update(sendAttempts)
      .set({
        result: "ambiguous",
        finishedAt: at,
        errorCode: result.error.code,
        errorDetail: result.error.safeMessage,
      })
      .where(attemptWhere);
    await tx
      .update(messages)
      .set({
        status: "RECONCILIATION_REQUIRED",
        reconciliationNextAt: addMinutes(at, RECONCILE_SCHEDULE_MIN[0]!),
        errorCode: result.error.code,
        errorMessage: result.error.safeMessage,
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: at,
      })
      .where(fence);
    return { kind: "ambiguous", messageId: m.id };
  });
}

/** After a confirmed send: event, recipient progression to the next step (or completion). */
async function afterSent(tx: AppDatabase, m: typeof messages.$inferSelect, sentAt: Date) {
  await tx
    .insert(messageEvents)
    .values({
      workspaceId: m.workspaceId,
      messageId: m.id,
      campaignRecipientId: m.campaignRecipientId,
      eventType: "sent",
      occurredAt: sentAt,
      source: "system",
      dedupeKey: `sent:${m.id}`,
    })
    .onConflictDoNothing();
  if (m.prospectId)
    await tx
      .update(prospectOutreachState)
      .set({ lastContactedAt: sentAt })
      .where(eq(prospectOutreachState.prospectId, m.prospectId));
  if (!m.campaignRecipientId || !m.campaignId || m.stepNumber == null) return;

  const [next] = await tx
    .select({ stepNumber: sequenceSteps.stepNumber, delayMinutes: sequenceSteps.delayMinutes })
    .from(sequenceSteps)
    .where(
      and(
        eq(sequenceSteps.campaignId, m.campaignId),
        eq(sequenceSteps.enabled, true),
        gt(sequenceSteps.stepNumber, m.stepNumber),
      ),
    )
    .orderBy(asc(sequenceSteps.stepNumber))
    .limit(1);
  const common = {
    lastSentStep: m.stepNumber,
    lastSentAt: sentAt,
    firstMessageRfcId: sql`coalesce(${campaignRecipients.firstMessageRfcId}, ${m.rfcMessageId})`,
    updatedAt: sentAt,
  };
  // State-guarded: a reply/bounce/unsubscribe that arrived meanwhile has already ended the recipient.
  await tx
    .update(campaignRecipients)
    .set(
      next
        ? {
            ...common,
            status: "SCHEDULED",
            nextStep: next.stepNumber,
            nextSendAt: addMinutes(sentAt, next.delayMinutes),
          }
        : { ...common, status: "COMPLETED", nextStep: null, nextSendAt: null },
    )
    .where(
      and(
        eq(campaignRecipients.id, m.campaignRecipientId),
        eq(campaignRecipients.status, "SENDING"),
      ),
    );
}

// ───────────────────────────── Reconciliation ─────────────────────────────

/**
 * Expired leases → RECONCILIATION_REQUIRED (a crashed worker may have sent). Due ambiguous
 * messages are checked for POSITIVE evidence only; none after the final check → OPERATOR_REVIEW.
 */
export async function reconcile(ctx: EngineContext, now = new Date()) {
  const expired = await ctx.db
    .update(messages)
    .set({
      status: "RECONCILIATION_REQUIRED",
      reconciliationNextAt: now,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: now,
    })
    .where(and(eq(messages.status, "SENDING"), lte(messages.leaseExpiresAt, now)))
    .returning({ id: messages.id });

  let confirmed = 0;
  let review = 0;
  const due = await ctx.db
    .select({ message: messages, isDemo: workspaces.isDemo, email: mailboxes.emailAddress })
    .from(messages)
    .innerJoin(mailboxes, eq(mailboxes.id, messages.mailboxId))
    .innerJoin(workspaces, eq(workspaces.id, messages.workspaceId))
    .where(
      and(eq(messages.status, "RECONCILIATION_REQUIRED"), lte(messages.reconciliationNextAt, now)),
    )
    .limit(50);
  for (const d of due) {
    const m = d.message;
    const provider = ctx.resolveProvider({
      id: m.mailboxId,
      workspaceId: m.workspaceId,
      isDemoWorkspace: d.isDemo,
    });
    const [checkpoint] = await ctx.db
      .select({ cp: sendAttempts.mailboxHistoryIdBefore })
      .from(sendAttempts)
      .where(eq(sendAttempts.messageId, m.id))
      .orderBy(sql`${sendAttempts.attemptNumber} desc`)
      .limit(1);
    const evidence = provider
      ? await provider
          .getMessageStatus(
            { mailboxId: m.mailboxId, emailAddress: d.email, config: {} },
            { messageId: m.rfcMessageId, lvMessageId: m.lvMessageHeader },
            checkpoint?.cp ?? null,
          )
          .catch(() => ({ found: false as const, checkedSources: [] }))
      : { found: false as const, checkedSources: [] };
    await ctx.db.transaction(async (tx) => {
      if (evidence.found) {
        const updated = await tx
          .update(messages)
          .set({
            status: "SENT",
            sentAt: evidence.observedAt,
            resolution: "confirmed_sent_auto",
            resolvedAt: now,
            updatedAt: now,
          })
          .where(and(eq(messages.id, m.id), eq(messages.status, "RECONCILIATION_REQUIRED")))
          .returning({ id: messages.id });
        if (updated.length) {
          await afterSent(tx, m, evidence.observedAt);
          confirmed++;
        }
        return;
      }
      const checks = m.reconciliationChecks + 1;
      const nextMin = RECONCILE_SCHEDULE_MIN[checks];
      await tx
        .update(messages)
        .set(
          nextMin === undefined
            ? {
                status: "OPERATOR_REVIEW",
                reconciliationChecks: checks,
                reconciliationNextAt: null,
                updatedAt: now,
              }
            : {
                reconciliationChecks: checks,
                reconciliationNextAt: addMinutes(now, nextMin),
                updatedAt: now,
              },
        )
        .where(and(eq(messages.id, m.id), eq(messages.status, "RECONCILIATION_REQUIRED")));
      if (nextMin === undefined) review++;
    });
  }
  return { expired: expired.length, confirmed, review };
}

/** Operator resolution of an ambiguous send (ADMIN+, audited by the caller). Never retries. */
export async function resolveReviewMessage(
  db: AppDatabase,
  workspaceId: string,
  messageId: string,
  action: "mark_sent" | "stop_recipient",
  userId: string,
  now = new Date(),
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [m] = await tx
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.workspaceId, workspaceId),
          eq(messages.id, messageId),
          inArray(messages.status, ["RECONCILIATION_REQUIRED", "OPERATOR_REVIEW"]),
        ),
      )
      .for("update");
    if (!m) return false;
    if (action === "mark_sent") {
      await tx
        .update(messages)
        .set({
          status: "SENT",
          sentAt: m.sentAt ?? now,
          resolution: "confirmed_sent_operator",
          resolvedBy: userId,
          resolvedAt: now,
          updatedAt: now,
        })
        .where(eq(messages.id, m.id));
      await afterSent(tx, m, m.sentAt ?? now);
    } else {
      await tx
        .update(messages)
        .set({
          status: "CANCELLED",
          resolution: "operator_stopped",
          resolvedBy: userId,
          resolvedAt: now,
          updatedAt: now,
        })
        .where(eq(messages.id, m.id));
      if (m.campaignRecipientId)
        await haltRecipients(
          tx,
          { kind: "recipients", ids: [m.campaignRecipientId] },
          "STOPPED",
          "OPERATOR_STOPPED",
          now,
          userId,
        );
    }
    return true;
  });
}
