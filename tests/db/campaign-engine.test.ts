import type { PGlite } from "@electric-sql/pglite";
import { and, eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AppDatabase } from "@/db/rls";
import * as s from "@/db/schema";
import { signUnsubscribeToken, verifyUnsubscribeToken } from "@/domain/unsubscribe-token";
import { uuidv7 } from "@/lib/ids";
import { FakeMailboxProvider } from "@/providers/mailbox/fake";
import {
  CampaignError,
  campaignResults,
  createCampaign,
  launchCampaign,
  planEnrollment,
  saveSteps,
  transitionCampaign,
  getCampaign,
} from "@/services/campaign-service";
import { processUnsubscribe, simulateInbound } from "@/services/inbound-service";
import type { SendConfig } from "@/services/send-config";
import {
  dispatchDue,
  executeNext,
  reconcile,
  runLifecycle,
  type EngineContext,
} from "@/services/send-engine";
import { addWorkspaceSuppression } from "@/services/suppression-service";
import { asUser, createAuthUser, createTestDatabase, pgErrorCode, type TestDb } from "./harness";

/**
 * The campaign execution pipeline end to end on real PostgreSQL, with the fake transport and a
 * controlled clock: launch → dispatch → claim → final eligibility check → personalize → fake send
 * → next step, and every stop rule.
 */
let db: TestDb;
let client: PGlite;
const sys = () => db as unknown as AppDatabase;
const U = { owner: uuidv7(), operator: uuidv7(), viewer: uuidv7(), ownerB: uuidv7() };
const WS = uuidv7();
const WS_B = uuidv7();
let mailboxId = "";
let clock = new Date("2026-10-05T15:00:00Z"); // Monday 10:00 in America/Chicago
const DAY = 86_400_000;
const at = (ms: number) => new Date(clock.getTime() + ms);
const SECRET = "test-unsubscribe-secret-0123456789-abcdefgh";
const config: SendConfig = {
  transport: "fake",
  sendingEnabled: true,
  appEnv: "local",
  unsubscribeSecret: SECRET,
  unsubscribeBaseUrl: "http://localhost:3100",
};
let fake: FakeMailboxProvider;
const engine = (workerId = "worker-1"): EngineContext => ({
  db: sys(),
  config,
  workerId,
  resolveProvider: () => fake,
});
const asOp = <T>(fn: (tx: AppDatabase) => Promise<T>, user = U.operator) =>
  asUser(db, user, (tx) => fn(tx as unknown as AppDatabase));

/** One worker pass at `now`: lifecycle, dispatcher, executor until idle, reconciliation. */
async function runWorker(now: Date) {
  await runLifecycle(sys(), now);
  await dispatchDue(engine(), now);
  for (let i = 0; i < 100; i++) {
    const r = await executeNext(engine(), now);
    if (r.kind === "idle" || r.kind === "disabled") break;
  }
  await reconcile(engine(), now);
}

let n = 0;
async function prospect(o: Partial<typeof s.prospects.$inferInsert> = {}) {
  n++;
  const domain = o.websiteDomain ?? `clinic-${n}.example`;
  const [p] = await db
    .insert(s.prospects)
    .values({
      workspaceId: WS,
      companyName: `Clinic ${n}`,
      website: `https://${domain}`,
      websiteDomain: domain,
      contactName: `Pat Doe${n}`,
      firstName: "Pat",
      lastName: `Doe${n}`,
      contactTitle: "Practice Manager",
      email: `pat${n}@${domain}`,
      emailNormalized: `pat${n}@${domain}`,
      emailDomain: domain,
      emailVerificationStatus: "VERIFIED",
      emailVerifiedAt: new Date(clock.getTime() - 10 * DAY),
      emailVerificationSource: "test",
      city: "Austin",
      state: "TX",
      countryCode: "US",
      regionCode: "US-TX",
      businessType: "Family Medicine",
      ...o,
    })
    .returning();
  return p!;
}

async function audienceOf(ids: string[]) {
  const [a] = await db
    .insert(s.audiences)
    .values({ workspaceId: WS, name: `Audience ${uuidv7()}`, createdBy: U.operator })
    .returning();
  if (ids.length)
    await db
      .insert(s.audienceMembers)
      .values(
        ids.map((prospectId) => ({
          audienceId: a!.id,
          prospectId,
          workspaceId: WS,
          addedVia: "manual" as const,
        })),
      );
  return a!.id;
}

const STEPS = [
  {
    subject: "Quick question for {{company_name}}",
    body: "Hi {{first_name|there}},\n\nA note for {{company_name}} in {{city}}.\n\n{{sender_name}}",
    delayMinutes: 0,
  },
  { body: "Hi {{first_name|there}}, following up on my note.", delayMinutes: 1440 },
  { body: "Hi {{first_name|there}}, last note from me.", delayMinutes: 2880 },
];

async function campaignFor(
  prospectIds: string[],
  extra: Record<string, unknown> = {},
  steps = STEPS,
) {
  const audienceId = await audienceOf(prospectIds);
  const id = await asOp((tx) =>
    createCampaign(
      tx,
      { workspaceId: WS, userId: U.operator },
      {
        name: `Campaign ${uuidv7()}`,
        audienceId,
        mailboxId,
        timezone: "America/Chicago",
        startMode: "launch",
        anyTime: true,
        sendDays: [],
        windowStart: "08:00",
        windowEnd: "17:00",
        ...extra,
      },
    ),
  );
  await asOp((tx) => saveSteps(tx, { workspaceId: WS }, id, steps));
  return id;
}

const launch = (id: string, now = clock) =>
  asOp((tx) =>
    launchCampaign(
      tx,
      { workspaceId: WS, userId: U.operator },
      id,
      { unsubscribeConfigured: true },
      now,
    ),
  );

async function recipientsOf(campaignId: string) {
  return db
    .select()
    .from(s.campaignRecipients)
    .where(eq(s.campaignRecipients.campaignId, campaignId));
}
async function messagesOf(recipientId: string) {
  return db
    .select()
    .from(s.messages)
    .where(eq(s.messages.campaignRecipientId, recipientId))
    .orderBy(s.messages.stepNumber);
}

beforeAll(async () => {
  ({ db, client } = await createTestDatabase());
  for (const [k, id] of Object.entries(U)) await createAuthUser(client, id, `${k}@test.example`, k);
  await db.insert(s.workspaces).values([
    {
      id: WS,
      name: "A",
      slug: "eng-a",
      defaultTimezone: "America/Chicago",
      compliancePostalAddress: "1 Example St, Austin, TX (fictional)",
    },
    { id: WS_B, name: "B", slug: "eng-b", defaultTimezone: "UTC" },
  ]);
  await db.insert(s.workspaceMembers).values([
    { workspaceId: WS, userId: U.owner, role: "OWNER" },
    { workspaceId: WS, userId: U.operator, role: "OPERATOR" },
    { workspaceId: WS, userId: U.viewer, role: "VIEWER" },
    { workspaceId: WS_B, userId: U.ownerB, role: "OWNER" },
  ]);
  // Test-only policy so ELIGIBLE is reachable; Georgia stays unconfigured (review).
  await db.insert(s.jurisdictionPolicies).values({
    scope: "workspace",
    workspaceId: WS,
    countryCode: "US",
    regionCode: "US-TX",
    outreachStatus: "allowed",
  });
  const [conn] = await db
    .insert(s.providerConnections)
    .values({
      workspaceId: WS,
      provider: "smtp_imap",
      accountEmail: "ops@outreach-a.example",
      status: "active",
      encryptedCredentials: Buffer.from("TEST-PLACEHOLDER"),
      credentialsKeyVersion: 0,
    })
    .returning();
  const [mb] = await db
    .insert(s.mailboxes)
    .values({
      workspaceId: WS,
      providerConnectionId: conn!.id,
      emailAddress: "alex@outreach-a.example",
      displayName: "Alex Sender",
      status: "CONNECTED",
      dailySendLimit: 500,
      minSecondsBetweenSends: 0,
      timezone: "America/Chicago",
      infraVendor: "test",
      warmupStatus: "ready",
      nextAvailableAt: new Date("2026-01-01T00:00:00Z"),
    })
    .returning();
  mailboxId = mb!.id;
  await db.insert(s.sendingIdentities).values({
    workspaceId: WS,
    mailboxId,
    fromName: "Alex Sender",
    fromEmail: "alex@outreach-a.example",
    isDefault: true,
  });
});

beforeEach(async () => {
  fake = new FakeMailboxProvider(() => clock);
  clock = new Date(clock.getTime() + 30 * DAY); // each test starts in a fresh period
  await db
    .update(s.mailboxes)
    .set({ nextAvailableAt: new Date("2026-01-01T00:00:00Z"), dailySendLimit: 500 });
  // Earlier tests' recipients must not block these prospects (ALREADY_IN_ACTIVE_CAMPAIGN).
  await db.execute(
    sql`update app.campaigns set status = 'CANCELLED' where status in ('ACTIVE','SCHEDULED','PAUSED')`,
  );
  await db.execute(
    sql`update app.campaign_recipients set status = 'CANCELLED' where status in ('QUEUED','SCHEDULED','SENDING')`,
  );
});

describe("launch and enrollment", () => {
  it("enrolls only eligible prospects with complete personalization, and explains every exclusion", async () => {
    const ok = await prospect();
    const noTitle = await prospect({ contactTitle: null });
    const georgia = await prospect({ state: "GA", regionCode: "US-GA" });
    const consumer = await prospect({
      email: "pat@gmail.com",
      emailNormalized: "pat@gmail.com",
      emailDomain: "gmail.com",
    });
    const unverified = await prospect({
      emailVerificationStatus: "UNKNOWN",
      emailVerifiedAt: null,
      emailVerificationSource: null,
    });
    const steps = [
      {
        subject: "For {{company_name}}",
        body: "Hi {{first_name}}, as {{contact_title}} …",
        delayMinutes: 0,
      },
    ];
    const id = await campaignFor(
      [ok.id, noTitle.id, georgia.id, consumer.id, unverified.id],
      {},
      steps,
    );

    const found = await asOp((tx) => getCampaign(tx, WS, id));
    const plan = await asOp((tx) => planEnrollment(tx, found!.campaign, found!.steps));
    const by = Object.fromEntries(plan.recipients.map((r) => [r.prospectId, r]));
    expect(by[ok.id]!.decision).toBe("enroll");
    expect(by[noTitle.id]!.category).toBe("MISSING_VARIABLE");
    expect(by[noTitle.id]!.reasons).toEqual(["MISSING_REQUIRED_VARIABLE:contact_title"]);
    expect(by[georgia.id]!.category).toBe("NEEDS_REVIEW");
    expect(by[georgia.id]!.reasons).toContain("JURISDICTION_REVIEW");
    expect(by[consumer.id]!.category).toBe("INELIGIBLE");
    expect(by[unverified.id]!.category).toBe("NEEDS_REVIEW");

    const res = await launch(id);
    expect(res).toEqual({ status: "ACTIVE", enrolled: 1, excluded: 4 });
    const rec = await recipientsOf(id);
    expect(rec.filter((r) => r.status === "SCHEDULED").map((r) => r.prospectId)).toEqual([ok.id]);
    expect(rec.find((r) => r.prospectId === georgia.id)!.excludedReasons).toContain(
      "JURISDICTION_REVIEW",
    );
  });

  it("prevents invalid state transitions server-side", async () => {
    const id = await campaignFor([(await prospect()).id]);
    await expect(
      asOp((tx) => transitionCampaign(tx, { workspaceId: WS, userId: U.operator }, id, "pause")),
    ).rejects.toThrow(CampaignError);
    await launch(id);
    await expect(launch(id)).rejects.toMatchObject({ code: "BAD_STATE" });
    await expect(
      asOp((tx) => transitionCampaign(tx, { workspaceId: WS, userId: U.operator }, id, "resume")),
    ).rejects.toMatchObject({ code: "BAD_STATE" });
    await expect(asOp((tx) => saveSteps(tx, { workspaceId: WS }, id, STEPS))).rejects.toMatchObject(
      { code: "NOT_EDITABLE" },
    );
  });

  it("rejects unknown personalization tokens when the sequence is saved", async () => {
    const id = await campaignFor([(await prospect()).id]);
    await expect(
      asOp((tx) =>
        saveSteps(tx, { workspaceId: WS }, id, [
          { subject: "Hi", body: "Hello {{firstname}}", delayMinutes: 0 },
        ]),
      ),
    ).rejects.toMatchObject({ code: "INVALID_STEPS" });
  });
});

describe("execution with the fake transport", () => {
  it("sends a 3-step sequence on schedule, threads follow-ups and completes the campaign", async () => {
    const p = await prospect();
    const id = await campaignFor([p.id]);
    await launch(id);
    const [r] = await recipientsOf(id);

    await runWorker(clock);
    let msgs = await messagesOf(r!.id);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.status).toBe("SENT");
    expect(msgs[0]!.subject).toBe(`Quick question for ${p.companyName}`);
    expect(msgs[0]!.bodyText).toContain("Hi Pat,");
    expect(msgs[0]!.bodyText).toContain("Alex Sender");
    expect(msgs[0]!.bodyText).not.toMatch(/undefined|null|\{\{/);
    expect(msgs[0]!.bodyText).toMatch(/opt out here: http:\/\/localhost:3100\/u\/v1\./);
    expect(fake.delivered).toHaveLength(1);
    expect(fake.delivered[0]!.message.listUnsubscribe?.oneClick).toBe(true);
    let [rec] = await recipientsOf(id);
    expect(rec).toMatchObject({ status: "SCHEDULED", lastSentStep: 1, nextStep: 2 });
    expect(rec!.nextSendAt!.getTime()).toBe(clock.getTime() + DAY);

    await runWorker(at(DAY / 2)); // not due yet
    expect(await messagesOf(r!.id)).toHaveLength(1);

    await runWorker(at(DAY + 60_000));
    msgs = await messagesOf(r!.id);
    expect(msgs).toHaveLength(2);
    expect(msgs[1]!.subject).toBe(`Re: Quick question for ${p.companyName}`);
    expect(msgs[1]!.inReplyTo).toBe(msgs[0]!.rfcMessageId);

    await runWorker(at(3 * DAY + 120_000));
    [rec] = await recipientsOf(id);
    expect(rec!.status).toBe("COMPLETED");
    expect(await messagesOf(r!.id)).toHaveLength(3);
    await runWorker(at(3 * DAY + 180_000));
    const [c] = await db.select().from(s.campaigns).where(eq(s.campaigns.id, id));
    expect(c!.status).toBe("COMPLETED");
    expect(await asOp((tx) => campaignResults(tx, WS, id))).toMatchObject({
      recipients: 1,
      sent: 3,
      completed: 1,
      remaining: 0,
    });
  });

  it("never creates or sends a second message for the same recipient and step", async () => {
    const id = await campaignFor([(await prospect()).id, (await prospect()).id]);
    await launch(id);
    await Promise.all([dispatchDue(engine("a"), clock), dispatchDue(engine("b"), clock)]);
    const outcomes = await Promise.all([
      executeNext(engine("a"), clock),
      executeNext(engine("b"), clock),
      executeNext(engine("c"), clock),
    ]);
    expect(outcomes.filter((o) => o.kind === "sent")).toHaveLength(2);
    await runWorker(clock);
    expect(fake.calls).toHaveLength(2);
    expect(new Set(fake.calls.map((c) => c.messageId)).size).toBe(2);

    const [r] = await recipientsOf(id);
    const [m] = await messagesOf(r!.id);
    const dup = db
      .insert(s.messages)
      .values({ ...m!, id: uuidv7(), rfcMessageId: "<dup@x.example>", lvMessageHeader: uuidv7() });
    expect(await pgErrorCode(dup)).toBe("23505");
  });

  it("treats an ambiguous send as uncertain: no retry, confirmed only by positive evidence", async () => {
    const id = await campaignFor([(await prospect()).id]);
    await launch(id);
    fake.scriptSends({ kind: "ambiguous", actuallySent: true });
    await runWorker(clock);
    const [r] = await recipientsOf(id);
    let [m] = await messagesOf(r!.id);
    expect(m!.status).toBe("RECONCILIATION_REQUIRED");
    expect(fake.calls).toHaveLength(1);
    await runWorker(at(2 * 60_000));
    [m] = await messagesOf(r!.id);
    expect(m).toMatchObject({ status: "SENT", resolution: "confirmed_sent_auto" });
    expect(fake.calls).toHaveLength(1); // never re-sent
    const [rec] = await recipientsOf(id);
    expect(rec!.status).toBe("SCHEDULED");
  });

  it("moves an expired lease to reconciliation and, without evidence, to operator review", async () => {
    const id = await campaignFor([(await prospect()).id]);
    await launch(id);
    await dispatchDue(engine(), clock);
    const [r] = await recipientsOf(id);
    const [m] = await messagesOf(r!.id);
    await db
      .update(s.messages)
      .set({
        status: "SENDING",
        leaseOwner: "crashed-worker",
        leaseExpiresAt: at(-1000),
        attemptCount: 1,
      })
      .where(eq(s.messages.id, m!.id));
    for (const minutes of [1, 3, 9, 25, 90]) await reconcile(engine(), at(minutes * 60_000));
    const [after] = await messagesOf(r!.id);
    expect(after!.status).toBe("OPERATOR_REVIEW");
    expect(fake.calls).toHaveLength(0);
    const [rec] = await recipientsOf(id);
    expect(rec!.status).toBe("SENDING"); // the sequence cannot advance or double-send
  });

  it("respects the sending window, the mailbox daily limit and pause/resume", async () => {
    const ids = [(await prospect()).id, (await prospect()).id, (await prospect()).id];
    const id = await campaignFor(ids, {
      anyTime: false,
      sendDays: [1, 2, 3, 4, 5],
      windowStart: "08:00",
      windowEnd: "17:00",
    });
    await launch(id);
    // Next Saturday and the Monday after it, 17:00 UTC (late morning in Chicago).
    const base = new Date(clock);
    base.setUTCHours(17, 0, 0, 0);
    const saturday = new Date(base.getTime() + ((6 - base.getUTCDay() + 7) % 7 || 7) * DAY);
    await runWorker(saturday);
    expect(fake.calls).toHaveLength(0);

    await db.update(s.mailboxes).set({ dailySendLimit: 2 }).where(eq(s.mailboxes.id, mailboxId));
    const monday = new Date(saturday.getTime() + 2 * DAY);
    await asOp((tx) =>
      transitionCampaign(tx, { workspaceId: WS, userId: U.operator }, id, "pause", monday),
    );
    await runWorker(monday);
    expect(fake.calls).toHaveLength(0);
    await asOp((tx) =>
      transitionCampaign(tx, { workspaceId: WS, userId: U.operator }, id, "resume", monday),
    );
    await runWorker(monday);
    expect(fake.calls).toHaveLength(2); // daily mailbox limit
  });

  it("stopping a campaign cancels everything not yet sent", async () => {
    const id = await campaignFor([(await prospect()).id, (await prospect()).id]);
    await launch(id);
    await dispatchDue(engine(), clock);
    await asOp((tx) => transitionCampaign(tx, { workspaceId: WS, userId: U.operator }, id, "stop"));
    await runWorker(clock);
    expect(fake.calls).toHaveLength(0);
    const rec = await recipientsOf(id);
    expect(rec.every((r) => r.status === "CANCELLED")).toBe(true);
    const msgs = await db.select().from(s.messages).where(eq(s.messages.campaignId, id));
    expect(msgs.every((m) => m.status === "CANCELLED")).toBe(true);
  });
});

describe("stop rules", () => {
  async function afterFirstSend() {
    const p = await prospect();
    const id = await campaignFor([p.id]);
    await launch(id);
    await runWorker(clock);
    const [r] = await recipientsOf(id);
    return { p, id, r: r! };
  }

  it("a reply stops the remaining sequence and appears as a thread", async () => {
    const { id, r } = await afterFirstSend();
    const res = await simulateInbound(sys(), WS, r.id, "reply", at(3_600_000));
    expect(res).toMatchObject({ kind: "human_reply", matched: true, stopped: true });
    await runWorker(at(5 * DAY));
    expect(await messagesOf(r.id)).toHaveLength(1);
    const [rec] = await recipientsOf(id);
    expect(rec!.status).toBe("REPLIED");
    const threads = await db
      .select()
      .from(s.replyThreads)
      .where(eq(s.replyThreads.campaignRecipientId, r.id));
    expect(threads).toHaveLength(1);
    // Ingestion is idempotent per provider message.
    const replies = await db
      .select()
      .from(s.replies)
      .where(eq(s.replies.replyThreadId, threads[0]!.id));
    expect(replies).toHaveLength(1);
  });

  it("an out-of-office reply does not stop the sequence", async () => {
    const { r } = await afterFirstSend();
    const res = await simulateInbound(sys(), WS, r.id, "out_of_office", at(3_600_000));
    expect(res).toMatchObject({ kind: "auto_reply", stopped: false });
    await runWorker(at(DAY + 60_000));
    expect(await messagesOf(r.id)).toHaveLength(2);
  });

  it("a hard bounce stops the sequence and suppresses the address LeadVault-wide", async () => {
    const { p, id, r } = await afterFirstSend();
    await simulateInbound(sys(), WS, r.id, "hard_bounce", at(600_000));
    const [rec] = await recipientsOf(id);
    expect(rec!.status).toBe("BOUNCED");
    const sup = await db
      .select()
      .from(s.suppressions)
      .where(
        and(
          eq(s.suppressions.valueNormalized, p.emailNormalized!),
          eq(s.suppressions.scope, "global"),
        ),
      );
    expect(sup).toHaveLength(1);
    expect(sup[0]!.reason).toBe("HARD_BOUNCE");
    const [state] = await db
      .select()
      .from(s.prospectOutreachState)
      .where(eq(s.prospectOutreachState.prospectId, p.id));
    expect(state!.eligibility).toBe("SUPPRESSED");
    await runWorker(at(5 * DAY));
    expect(await messagesOf(r.id)).toHaveLength(1);
    expect(await asOp((tx) => campaignResults(tx, WS, id))).toMatchObject({ bounced: 1, sent: 1 });
  });

  it("an unsubscribe link stops future messages, idempotently, without exposing anything", async () => {
    const { p, id, r } = await afterFirstSend();
    const [m] = await messagesOf(r.id);
    const token = signUnsubscribeToken(m!.id, SECRET);
    expect(verifyUnsubscribeToken(token, SECRET)).toBe(m!.id);
    expect(verifyUnsubscribeToken(token.slice(0, -2) + "xx", SECRET)).toBeNull();
    expect(verifyUnsubscribeToken(token, "another-secret-0123456789-0123456789")).toBeNull();

    expect(await processUnsubscribe(sys(), { messageId: m!.id, method: "one_click_post" })).toEqual(
      { ok: true, alreadyUnsubscribed: false },
    );
    expect(await processUnsubscribe(sys(), { messageId: m!.id, method: "one_click_post" })).toEqual(
      { ok: true, alreadyUnsubscribed: true },
    );
    const [rec] = await recipientsOf(id);
    expect(rec!.status).toBe("UNSUBSCRIBED");
    const [state] = await db
      .select()
      .from(s.prospectOutreachState)
      .where(eq(s.prospectOutreachState.prospectId, p.id));
    expect(state!.eligibilityReasons).toContain("UNSUBSCRIBED");
    await runWorker(at(5 * DAY));
    expect(await messagesOf(r.id)).toHaveLength(1);
  });

  it("an opt-out reply is both a reply and an unsubscribe", async () => {
    const { p, id, r } = await afterFirstSend();
    await simulateInbound(sys(), WS, r.id, "opt_out_reply", at(600_000));
    const [rec] = await recipientsOf(id);
    expect(rec!.status).toBe("REPLIED");
    const unsubs = await db
      .select()
      .from(s.unsubscribes)
      .where(eq(s.unsubscribes.emailNormalized, p.emailNormalized!));
    expect(unsubs.map((u) => u.method)).toEqual(["reply"]);
  });

  it("a new suppression stops live recipients immediately", async () => {
    const { p, id } = await afterFirstSend();
    await asOp((tx) =>
      addWorkspaceSuppression(
        tx,
        { workspaceId: WS, userId: U.operator },
        {
          valueType: "domain",
          value: p.emailDomain!,
          reason: "MANUAL_DO_NOT_CONTACT",
          note: "asked not to be contacted",
        },
      ),
    );
    const [rec] = await recipientsOf(id);
    expect(rec!.status).toBe("SUPPRESSED");
  });

  it("the final eligibility check stops a recipient whose prospect became ineligible", async () => {
    const { p, id, r } = await afterFirstSend();
    // Data changed behind the cache's back (no fan-out): the worker must still catch it.
    await db
      .update(s.prospects)
      .set({ emailVerificationStatus: "INVALID" })
      .where(eq(s.prospects.id, p.id));
    await runWorker(at(DAY + 60_000));
    const [rec] = await recipientsOf(id);
    expect(rec!.status).toBe("STOPPED");
    expect(rec!.stopReason).toContain("EMAIL_VERIFICATION_FAILED");
    expect(await messagesOf(r.id)).toHaveLength(1);
  });
});

describe("authorization and workspace isolation", () => {
  it("viewers cannot create or launch campaigns", async () => {
    const audienceId = await audienceOf([]);
    const code = await pgErrorCode(
      asOp(
        (tx) =>
          createCampaign(
            tx,
            { workspaceId: WS, userId: U.viewer },
            {
              name: "Nope",
              audienceId,
              mailboxId,
              timezone: "UTC",
              startMode: "launch",
              anyTime: true,
              sendDays: [],
              windowStart: "08:00",
              windowEnd: "17:00",
            },
          ),
        U.viewer,
      ),
    );
    expect(code).toBe("42501");
  });

  it("another workspace cannot read, launch, change or simulate on this campaign", async () => {
    const { id, r } = await (async () => {
      const cid = await campaignFor([(await prospect()).id]);
      await launch(cid);
      await runWorker(clock);
      const [rec] = await recipientsOf(cid);
      return { id: cid, r: rec! };
    })();
    const asB = <T>(fn: (tx: AppDatabase) => Promise<T>) => asOp(fn, U.ownerB);
    expect(await asB((tx) => getCampaign(tx, WS, id))).toBeNull();
    expect(await asB((tx) => getCampaign(tx, WS_B, id))).toBeNull();
    await expect(
      asB((tx) =>
        launchCampaign(tx, { workspaceId: WS_B, userId: U.ownerB }, id, {
          unsubscribeConfigured: true,
        }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      asB((tx) => transitionCampaign(tx, { workspaceId: WS_B, userId: U.ownerB }, id, "stop")),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const changed = await asB((tx) =>
      tx
        .update(s.campaignRecipients)
        .set({ status: "STOPPED" })
        .where(eq(s.campaignRecipients.id, r.id))
        .returning(),
    );
    expect(changed).toHaveLength(0);
    const seen = await asB((tx) =>
      tx.select().from(s.messages).where(eq(s.messages.campaignId, id)),
    );
    expect(seen).toHaveLength(0);
    expect(await simulateInbound(sys(), WS_B, r.id, "reply")).toBeNull();
  });
});
