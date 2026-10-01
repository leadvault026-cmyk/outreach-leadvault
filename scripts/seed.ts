/**
 * Demo/development seed — LOCAL ONLY.
 *
 * Creates clearly fictional data for two demo workspaces so the dashboard and workspace-isolation
 * behaviour can be exercised. All people, companies and domains are invented; email domains use
 * the reserved `.test` / `.example` TLDs (RFC 2606), so nothing here can reach a real inbox.
 * No email is sent. Refuses to run against anything other than a local database.
 */
import { existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as s from "../src/db/schema";
import { uuidv7 } from "../src/lib/ids";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const DAY = 86_400_000;

// ───────────────────────────── Safety ─────────────────────────────
function assertLocal() {
  const dbUrl = process.env.DATABASE_URL ?? "";
  const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const isLocal = (u: string) => /^(postgres(ql)?|https?):\/\/([^@/]*@)?(127\.0\.0\.1|localhost)(:\d+)?/.test(u);
  if (process.env.APP_ENV !== "local" || !isLocal(dbUrl) || !isLocal(apiUrl)) {
    console.error("Refusing to seed: APP_ENV must be 'local' and both database and Supabase URLs must be localhost.");
    process.exit(1);
  }
  if (!process.env.SUPABASE_SECRET_KEY) {
    console.error("SUPABASE_SECRET_KEY is required (local stack: `npx supabase status`).");
    process.exit(1);
  }
  const pw = process.env.SEED_DEMO_PASSWORD ?? "";
  if (pw.length < 12 || !/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw)) {
    console.error("SEED_DEMO_PASSWORD must be ≥12 chars with upper, lower and a digit (set it in .env.local).");
    process.exit(1);
  }
}

// Deterministic PRNG so the demo looks the same on every reset.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261001);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

// ───────────────────────────── Fictional vocabulary ─────────────────────────────
const FIRST = ["Avery", "Blake", "Cameron", "Dana", "Elliot", "Frankie", "Harper", "Jules", "Kendall", "Logan", "Marley", "Noel", "Parker", "Quinn", "Reese", "Rowan", "Sage", "Skyler", "Tatum", "Wren"];
const LAST = ["Abbott", "Barrow", "Calder", "Dunmore", "Ellery", "Fairley", "Garrick", "Hollis", "Ivers", "Jessop", "Kingsley", "Lowell", "Marlow", "Nesbit", "Orwin", "Pembury", "Quarry", "Rendell", "Stroud", "Thorne"];
const COMPANY_A = ["Bluebonnet", "Lone Oak", "Pecan Grove", "Cedar Ridge", "Riverbend", "Prairie View", "Live Oak", "Mesquite", "Brazos", "Hill Country", "Peachtree", "Magnolia", "Sweetgum", "Red Clay", "Chattahoochee"];
const COMPANY_B = ["Family Medicine", "Pediatrics", "Orthopedic Group", "Dermatology", "Physical Therapy", "Urgent Care", "Cardiology Associates", "Women's Health", "Sports Medicine", "Allergy Clinic"];
const TITLES = ["Practice Manager", "Office Manager", "Medical Director", "Operations Director", "Clinic Administrator", "Owner"];
const TX_CITIES = ["Austin", "Houston", "San Antonio", "Dallas", "Fort Worth", "Waco"];
const GA_CITIES = ["Atlanta", "Savannah", "Augusta", "Macon", "Athens"];
const VERIFICATION = ["valid", "valid", "valid", "valid", "catch-all", "unknown", "valid"];

function slugify(v: string) {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ───────────────────────────── Main ─────────────────────────────
async function main() {
  assertLocal();

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  const db = drizzle(sql, { schema: s });
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const existing = await db.select({ id: s.workspaces.id }).from(s.workspaces).where(eq(s.workspaces.slug, "northwind-demo"));
  if (existing.length > 0) {
    console.log("Demo data already present. Run `npm run db:reset` for a clean database.");
    await sql.end();
    return;
  }

  // Users (auth.users via the Admin API; profiles are created by the DB trigger).
  const password = process.env.SEED_DEMO_PASSWORD!;
  const people = [
    { key: "owner", email: "owner@leadvault-demo.test", name: "Morgan Ellis" },
    { key: "admin", email: "admin@leadvault-demo.test", name: "Riley Chen" },
    { key: "operator", email: "operator@leadvault-demo.test", name: "Sam Patel" },
    { key: "viewer", email: "viewer@leadvault-demo.test", name: "Jordan Brooks" },
    { key: "isolated", email: "isolated@leadvault-demo.test", name: "Casey Nguyen" },
  ] as const;
  const userIds: Record<string, string> = {};
  const { data: listed } = await admin.auth.admin.listUsers({ perPage: 200 });
  for (const p of people) {
    const found = listed?.users.find((u) => u.email === p.email);
    if (found) {
      userIds[p.key] = found.id;
      continue;
    }
    const { data, error } = await admin.auth.admin.createUser({
      email: p.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: p.name },
    });
    if (error || !data.user) throw new Error(`Could not create demo user ${p.email}: ${error?.message}`);
    userIds[p.key] = data.user.id;
  }
  await db.update(s.profiles).set({ isPlatformAdmin: true }).where(eq(s.profiles.userId, userIds.owner!));

  const now = Date.now();

  await db.transaction(async (tx) => {
    // ── Workspaces & membership ──
    const wsA = uuidv7();
    const wsB = uuidv7();
    await tx.insert(s.workspaces).values([
      { id: wsA, name: "Northwind Clinics (Demo)", slug: "northwind-demo", kind: "client", defaultTimezone: "America/Chicago", senderCountryCode: "US", isDemo: true, createdBy: userIds.owner },
      { id: wsB, name: "Harbor Dental Group (Demo)", slug: "harbor-demo", kind: "client", defaultTimezone: "Europe/London", senderCountryCode: "GB", isDemo: true, createdBy: userIds.owner },
    ]);
    await tx.insert(s.workspaceMembers).values([
      { workspaceId: wsA, userId: userIds.owner!, role: "OWNER" },
      { workspaceId: wsA, userId: userIds.admin!, role: "ADMIN", invitedBy: userIds.owner },
      { workspaceId: wsA, userId: userIds.operator!, role: "OPERATOR", invitedBy: userIds.owner },
      { workspaceId: wsA, userId: userIds.viewer!, role: "VIEWER", invitedBy: userIds.owner },
      { workspaceId: wsB, userId: userIds.owner!, role: "OWNER" },
      { workspaceId: wsB, userId: userIds.isolated!, role: "OWNER", invitedBy: userIds.owner },
    ]);

    // ── Infrastructure (no real provider; placeholder bytes are not credentials) ──
    async function infra(ws: string, domain: string, boxes: Array<{ local: string; name: string; status: "CONNECTED" | "NEEDS_ATTENTION"; reason?: string }>) {
      const connId = uuidv7();
      await tx.insert(s.providerConnections).values({
        id: connId, workspaceId: ws, provider: "smtp_imap", accountEmail: `ops@${domain}`, status: "active",
        encryptedCredentials: Buffer.from("DEMO-PLACEHOLDER-NO-CREDENTIALS"), credentialsKeyVersion: 0,
        metadata: { demo: true },
      });
      const out: Array<{ id: string; email: string; identityId: string; name: string }> = [];
      for (const b of boxes) {
        const id = uuidv7();
        const email = `${b.local}@${domain}`;
        await tx.insert(s.mailboxes).values({
          id, workspaceId: ws, providerConnectionId: connId, emailAddress: email, displayName: b.name,
          status: b.status, statusReason: b.reason ?? null, dailySendLimit: 30, timezone: "America/Chicago",
          infraVendor: "demo", warmupStatus: "ready", warmupStartedAt: new Date(now - 40 * DAY),
        });
        const identityId = uuidv7();
        await tx.insert(s.sendingIdentities).values({ id: identityId, workspaceId: ws, mailboxId: id, fromName: b.name, fromEmail: email, isDefault: true });
        out.push({ id, email, identityId, name: b.name });
      }
      return out;
    }
    const boxesA = await infra(wsA, "northwind-outreach.example", [
      { local: "alex", name: "Alex Romero", status: "CONNECTED" },
      { local: "taylor", name: "Taylor Webb", status: "CONNECTED" },
      { local: "jamie", name: "Jamie Hart", status: "NEEDS_ATTENTION", reason: "Hard-bounce rate above 2% — auto-paused (demo)" },
    ]);
    const boxesB = await infra(wsB, "harbor-outreach.example", [{ local: "lee", name: "Lee Morgan", status: "CONNECTED" }]);

    // ── Prospects (research truth) + outreach state ──
    async function makeProspects(ws: string, count: number, region: "TX" | "GA" | "GB") {
      const rows: Array<{ id: string; email: string; first: string; last: string; company: string }> = [];
      const used = new Set<string>();
      for (let i = 0; i < count; i++) {
        let company = "";
        do company = `${pick(COMPANY_A)} ${pick(COMPANY_B)}`;
        while (used.has(company));
        used.add(company);
        const first = pick(FIRST);
        const last = pick(LAST);
        const domain = `${slugify(company)}.example`;
        const email = `${first.toLowerCase()}.${last.toLowerCase()}@${domain}`;
        const id = uuidv7();
        const label = pick(VERIFICATION);
        const status = label === "valid" ? "VERIFIED" : label === "catch-all" ? "RISKY" : "UNKNOWN";
        const isUs = region !== "GB";
        await tx.insert(s.prospects).values({
          id, workspaceId: ws, companyName: company, website: `https://www.${domain}`, websiteDomain: domain,
          contactName: `${first} ${last}`, firstName: first, lastName: last, contactTitle: pick(TITLES),
          email, emailNormalized: email, emailDomain: domain,
          emailVerificationStatus: status, emailVerifiedAt: status === "UNKNOWN" ? null : new Date(now - int(5, 60) * DAY),
          emailVerificationSource: status === "UNKNOWN" ? null : "research_import", emailVerificationDetail: label,
          phone: isUs ? `+1-555-01${String(int(0, 99)).padStart(2, "0")}` : `+44 20 7946 0${int(100, 999)}`,
          city: region === "TX" ? pick(TX_CITIES) : region === "GA" ? pick(GA_CITIES) : "Bristol",
          state: isUs ? region : null, countryCode: isUs ? "US" : "GB", regionCode: isUs ? `US-${region}` : null,
          businessType: company.split(" ").slice(-2).join(" "), qualificationBasis: "Independent practice with 3–20 providers (demo criterion)",
          evidenceUrl: `https://www.${domain}/about`, researchSourceRef: `DEMO-${region}-${1000 + i}`,
          researchApprovedAt: new Date(now - 30 * DAY),
        });
        await tx.insert(s.prospectOutreachState).values({
          prospectId: id, workspaceId: ws, eligibility: "NEEDS_REVIEW",
          // No jurisdiction is configured yet, so every prospect resolves to REVIEW (fail closed).
          eligibilityReasons: status === "VERIFIED" ? ["JURISDICTION_REVIEW"] : ["JURISDICTION_REVIEW", "EMAIL_UNVERIFIED"],
          eligibilityCheckedAt: new Date(now - DAY),
        });
        rows.push({ id, email, first, last, company });
      }
      return rows;
    }
    const prospectsTx = await makeProspects(wsA, 34, "TX");
    const prospectsGa = await makeProspects(wsA, 22, "GA");
    const prospectsB = await makeProspects(wsB, 8, "GB");

    // ── Audiences ──
    const audTx = uuidv7();
    const audGa = uuidv7();
    await tx.insert(s.audiences).values([
      { id: audTx, workspaceId: wsA, name: "Texas Medical Providers", description: "Independent practices across Texas (demo)", createdBy: userIds.operator },
      { id: audGa, workspaceId: wsA, name: "Georgia Healthcare Prospects", description: "Georgia clinics (demo)", createdBy: userIds.operator },
    ]);
    await tx.insert(s.audienceMembers).values([
      ...prospectsTx.map((p) => ({ audienceId: audTx, prospectId: p.id, workspaceId: wsA, addedVia: "manual" as const, addedBy: userIds.operator })),
      ...prospectsGa.map((p) => ({ audienceId: audGa, prospectId: p.id, workspaceId: wsA, addedVia: "manual" as const, addedBy: userIds.operator })),
    ]);

    await tx.insert(s.templates).values({
      workspaceId: wsA, name: "Practice operations intro", subject: "Quick question about {{company_name}}",
      body: "Hi {{first_name}},\n\nI noticed {{company_name}} in {{city}} …\n\n{{sender_name}}",
      variablesUsed: ["first_name", "company_name", "city", "sender_name"], createdBy: userIds.operator,
    });

    // ── Campaigns, steps, recipients, messages, events, replies ──
    type CampaignSpec = {
      name: string; status: "ACTIVE" | "PAUSED" | "DRAFT"; audience: string | null; mailbox: (typeof boxesA)[number];
      prospects: typeof prospectsTx; pauseReason?: string; launchedDaysAgo?: number;
    };
    const specs: CampaignSpec[] = [
      { name: "Texas Medical Providers — Q4", status: "ACTIVE", audience: audTx, mailbox: boxesA[0]!, prospects: prospectsTx.slice(0, 26), launchedDaysAgo: 13 },
      { name: "Georgia Healthcare Prospects", status: "ACTIVE", audience: audGa, mailbox: boxesA[1]!, prospects: prospectsGa.slice(0, 18), launchedDaysAgo: 9 },
      { name: "Houston Specialty Clinics", status: "PAUSED", audience: audTx, mailbox: boxesA[2]!, prospects: prospectsTx.slice(26, 34), pauseReason: "Sending mailbox needs attention (demo)", launchedDaysAgo: 6 },
      { name: "Dental Groups — Pilot", status: "DRAFT", audience: null, mailbox: boxesA[0]!, prospects: [] },
    ];

    const classifications = ["INTERESTED", "INTERESTED", "NOT_INTERESTED", "FOLLOW_UP", "UNREVIEWED", "UNREVIEWED", "OUT_OF_OFFICE"] as const;
    const snippets: Record<string, string> = {
      INTERESTED: "Thanks for reaching out — happy to take a look. Could you send over a few times next week?",
      NOT_INTERESTED: "We're all set for now, thank you.",
      FOLLOW_UP: "Not a good time this month. Please check back with me in January.",
      UNREVIEWED: "Who would I talk to about pricing for a practice our size?",
      OUT_OF_OFFICE: "I'm out of the office until Monday with limited access to email.",
    };
    let bounceBudget = 2;
    let reviewBudget = 1;

    for (const spec of specs) {
      const campaignId = uuidv7();
      const launchedAt = spec.launchedDaysAgo ? new Date(now - spec.launchedDaysAgo * DAY) : null;
      await tx.insert(s.campaigns).values({
        id: campaignId, workspaceId: wsA, name: spec.name, description: "Demo campaign — fictional recipients",
        objective: "Book introductory calls", status: spec.status, audienceId: spec.audience, mailboxId: spec.mailbox.id,
        sendingIdentityId: spec.mailbox.identityId, timezone: "America/Chicago", sendDays: [1, 2, 3, 4, 5],
        windowStart: "08:00", windowEnd: "17:00", dailyLimit: 25, minSecondsBetweenSends: 120,
        targetCountryCodes: ["US"], launchedAt, launchedBy: launchedAt ? userIds.operator : null,
        pausedAt: spec.status === "PAUSED" ? new Date(now - DAY) : null, pauseReason: spec.pauseReason ?? null,
        createdBy: userIds.operator,
      });
      const steps = [1, 2, 3].map((n) => ({
        id: uuidv7(), workspaceId: wsA, campaignId, stepNumber: n, delayMinutes: n === 1 ? 0 : 3 * 24 * 60,
        threadMode: n === 1 ? ("new" as const) : ("reply" as const),
        subject: n === 1 ? "Quick question about {{company_name}}" : null,
        body: n === 1 ? "Hi {{first_name}}, …" : "Hi {{first_name}}, following up on my note …",
      }));
      await tx.insert(s.sequenceSteps).values(steps);
      if (!launchedAt) continue;

      for (const p of spec.prospects) {
        const recipientId = uuidv7();
        const firstSend = new Date(launchedAt.getTime() + int(0, Math.max(1, spec.launchedDaysAgo! - 1)) * DAY + int(1, 8) * 3_600_000);
        if (firstSend.getTime() > now) continue;
        const willBounce = bounceBudget > 0 && rand() < 0.08;
        const replies = !willBounce && rand() < 0.22;
        const secondSend = new Date(firstSend.getTime() + 3 * DAY);
        const sendSecond = !willBounce && !replies && secondSend.getTime() < now;
        const needsReview = !willBounce && !replies && !sendSecond && reviewBudget > 0 && rand() < 0.2;

        const status = willBounce ? "BOUNCED" : replies ? "REPLIED" : spec.status === "PAUSED" ? "SCHEDULED" : "SCHEDULED";
        const lastSent = sendSecond ? 2 : 1;
        await tx.insert(s.campaignRecipients).values({
          id: recipientId, workspaceId: wsA, campaignId, prospectId: p.id, emailNormalized: p.email,
          status: needsReview ? "SENDING" : status, lastSentStep: needsReview ? 1 : lastSent,
          nextStep: status === "SCHEDULED" && !needsReview ? lastSent + 1 : null,
          nextSendAt: status === "SCHEDULED" && !needsReview ? new Date(Math.max(now + DAY, (sendSecond ? secondSend : firstSend).getTime() + 3 * DAY)) : null,
          stopReason: willBounce ? "HARD_BOUNCE" : replies ? "REPLIED" : null,
          enrolledAt: launchedAt, enrolledBy: userIds.operator, lastSentAt: sendSecond ? secondSend : firstSend,
        });

        const sendMessage = async (step: (typeof steps)[number], at: Date, msgStatus: "SENT" | "OPERATOR_REVIEW") => {
          const id = uuidv7();
          await tx.insert(s.messages).values({
            id, workspaceId: wsA, kind: "sequence", campaignId, campaignRecipientId: recipientId,
            sequenceStepId: step.id, stepNumber: step.stepNumber, prospectId: p.id, mailboxId: spec.mailbox.id,
            sendingIdentityId: spec.mailbox.identityId, toEmail: p.email, fromEmail: spec.mailbox.email,
            fromName: spec.mailbox.name, subject: step.stepNumber === 1 ? `Quick question about ${p.company}` : `Re: Quick question about ${p.company}`,
            bodyText: `Hi ${p.first}, … (demo content)`, rfcMessageId: `<${id}@northwind-outreach.example>`,
            lvMessageHeader: id, status: msgStatus, scheduledFor: at, attemptCount: 1,
            sentAt: msgStatus === "SENT" ? at : null,
            providerMessageId: msgStatus === "SENT" ? `demo-${id}` : null,
            errorCode: msgStatus === "OPERATOR_REVIEW" ? "TIMEOUT" : null,
            errorMessage: msgStatus === "OPERATOR_REVIEW" ? "The mail provider did not respond in time." : null,
            reconciliationChecks: msgStatus === "OPERATOR_REVIEW" ? 4 : 0,
          });
          if (msgStatus === "SENT") {
            await tx.insert(s.messageEvents).values({
              workspaceId: wsA, messageId: id, campaignRecipientId: recipientId, eventType: "sent",
              occurredAt: at, source: "system", dedupeKey: `sent:${id}`,
            });
          }
          return id;
        };

        if (needsReview) {
          reviewBudget--;
          await sendMessage(steps[0]!, firstSend, "OPERATOR_REVIEW");
          continue;
        }
        const firstId = await sendMessage(steps[0]!, firstSend, "SENT");
        if (sendSecond) await sendMessage(steps[1]!, secondSend, "SENT");

        if (willBounce) {
          bounceBudget--;
          const at = new Date(firstSend.getTime() + 10 * 60_000);
          await tx.update(s.messages).set({ bouncedAt: at, bounceType: "hard" }).where(eq(s.messages.id, firstId));
          await tx.insert(s.messageEvents).values({
            workspaceId: wsA, messageId: firstId, campaignRecipientId: recipientId, eventType: "hard_bounce",
            occurredAt: at, source: "mailbox_sync", dedupeKey: `hard_bounce:${firstId}:demo`, data: { status: "5.1.1" },
          });
          await tx.insert(s.suppressions).values({
            scope: "global", valueType: "email", valueNormalized: p.email, reason: "HARD_BOUNCE", source: "bounce",
            sourceMessageId: firstId, sourceCampaignId: campaignId, note: "Demo hard bounce (5.1.1)",
          });
        }

        if (replies) {
          const cls = pick(classifications);
          const receivedAt = new Date(firstSend.getTime() + int(2, 40) * 3_600_000);
          if (receivedAt.getTime() > now) continue;
          const threadId = uuidv7();
          await tx.insert(s.replyThreads).values({
            id: threadId, workspaceId: wsA, mailboxId: spec.mailbox.id, providerThreadId: `demo-thread-${threadId}`,
            campaignId, campaignRecipientId: recipientId, prospectId: p.id, subject: `Re: Quick question about ${p.company}`,
            classification: cls, classifiedBy: cls === "UNREVIEWED" ? null : userIds.operator,
            classifiedAt: cls === "UNREVIEWED" ? null : receivedAt, isUnread: cls === "UNREVIEWED", lastMessageAt: receivedAt,
          });
          const replyId = uuidv7();
          await tx.insert(s.replies).values({
            id: replyId, workspaceId: wsA, mailboxId: spec.mailbox.id, replyThreadId: threadId,
            providerMessageId: `demo-in-${replyId}`, rfcMessageId: `<${replyId}@${p.email.split("@")[1]}>`,
            inReplyTo: `<${firstId}@northwind-outreach.example>`, fromEmail: p.email, fromName: `${p.first} ${p.last}`,
            toEmails: [spec.mailbox.email], subject: `Re: Quick question about ${p.company}`, snippet: snippets[cls],
            bodyText: snippets[cls], receivedAt, kind: cls === "OUT_OF_OFFICE" ? "auto_reply" : "human_reply",
            matchedMessageId: firstId, matchMethod: "in_reply_to", processedAt: receivedAt,
          });
          await tx.insert(s.messageEvents).values({
            workspaceId: wsA, messageId: firstId, campaignRecipientId: recipientId,
            eventType: cls === "OUT_OF_OFFICE" ? "auto_replied" : "replied", occurredAt: receivedAt,
            source: "mailbox_sync", dedupeKey: `reply:${replyId}`,
          });
          await tx.update(s.campaignRecipients).set({ repliedAt: receivedAt }).where(eq(s.campaignRecipients.id, recipientId));
        }
      }
    }

    // Workspace B: a small, separate dataset used to demonstrate isolation.
    const campaignB = uuidv7();
    await tx.insert(s.campaigns).values({
      id: campaignB, workspaceId: wsB, name: "Bristol Dental Practices", status: "DRAFT",
      mailboxId: boxesB[0]!.id, sendingIdentityId: boxesB[0]!.identityId, createdBy: userIds.isolated,
    });
    await tx.insert(s.suppressions).values({
      scope: "workspace", workspaceId: wsB, valueType: "domain", valueNormalized: "do-not-contact.example",
      reason: "MANUAL_DO_NOT_CONTACT", source: "manual", note: "Demo workspace-scoped suppression", createdBy: userIds.isolated,
    });
    void prospectsB;
  });

  console.log("Demo data seeded (fictional, local only).");
  console.log("Demo accounts (password = SEED_DEMO_PASSWORD from .env.local):");
  for (const p of people) console.log(`  ${p.email}`);
  await sql.end();
}

main().catch((error) => {
  console.error("Seed failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
