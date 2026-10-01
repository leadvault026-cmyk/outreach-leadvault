import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppDatabase } from "@/db/rls";
import {
  audienceMembers,
  audiences,
  campaignRecipients,
  campaigns,
  mailboxes,
  messages,
  prospects,
  replyThreads,
  sendingIdentities,
  sequenceSteps,
  workspaces,
} from "@/db/schema";
import {
  canTransition,
  isValidTimeZone,
  zonedTimeToUtc,
  type CampaignAction,
} from "@/domain/campaigns";
import { composeMessage, type ComposeStep } from "@/domain/compose";
import type { EligibilityResult } from "@/domain/eligibility";
import { prospectTokenValues, validateTemplateText } from "@/domain/personalization";
import { evaluateProspects } from "./eligibility-service";
import { haltRecipients } from "./recipient-control";

/**
 * Campaigns (architecture §9): settings, a linear sequence, preview, launch (enrollment with the
 * authoritative eligibility engine) and operator transitions. Every write is state-guarded.
 */

export class CampaignError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CampaignError";
  }
}

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM.");

export const campaignSettingsSchema = z
  .object({
    name: z.string().trim().min(2, "Name the campaign (at least 2 characters).").max(120),
    description: z
      .string()
      .trim()
      .max(500)
      .optional()
      .transform((v) => v || null),
    audienceId: z.uuid("Choose an audience."),
    mailboxId: z.uuid("Choose a sending mailbox."),
    timezone: z.string().refine(isValidTimeZone, "Choose a valid time zone."),
    startMode: z.enum(["launch", "at"]),
    startDate: z.string().optional(),
    startTime: z.string().optional(),
    anyTime: z.boolean(),
    sendDays: z.array(z.number().int().min(1).max(7)).max(7),
    windowStart: time,
    windowEnd: time,
    dailyLimit: z.coerce.number().int().min(1).max(2000).optional().nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.startMode === "at" && (!v.startDate || !/^\d{4}-\d{2}-\d{2}$/.test(v.startDate)))
      ctx.addIssue({ code: "custom", path: ["startDate"], message: "Choose a start date." });
    if (v.startMode === "at" && (!v.startTime || !/^\d{2}:\d{2}$/.test(v.startTime)))
      ctx.addIssue({ code: "custom", path: ["startTime"], message: "Choose a start time." });
    if (!v.anyTime && v.windowStart >= v.windowEnd)
      ctx.addIssue({
        code: "custom",
        path: ["windowEnd"],
        message: "The window must end after it starts.",
      });
    if (!v.anyTime && v.sendDays.length === 0)
      ctx.addIssue({
        code: "custom",
        path: ["sendDays"],
        message: "Choose at least one sending day.",
      });
  });
export type CampaignSettingsInput = z.input<typeof campaignSettingsSchema>;

function settingsToColumns(v: z.output<typeof campaignSettingsSchema>) {
  return {
    name: v.name,
    description: v.description,
    audienceId: v.audienceId,
    mailboxId: v.mailboxId,
    timezone: v.timezone,
    startAt: v.startMode === "at" ? zonedTimeToUtc(v.startDate!, v.startTime!, v.timezone) : null,
    sendDays: v.anyTime ? null : [...v.sendDays].sort(),
    windowStart: v.anyTime ? null : v.windowStart,
    windowEnd: v.anyTime ? null : v.windowEnd,
    dailyLimit: v.dailyLimit ?? null,
  };
}

async function assertRefs(
  db: AppDatabase,
  workspaceId: string,
  audienceId: string,
  mailboxId: string,
) {
  const [aud] = await db
    .select({ id: audiences.id })
    .from(audiences)
    .where(
      and(
        eq(audiences.workspaceId, workspaceId),
        eq(audiences.id, audienceId),
        isNull(audiences.archivedAt),
      ),
    );
  if (!aud) throw new CampaignError("AUDIENCE_NOT_FOUND", "That audience was not found.");
  const [mb] = await db
    .select({ id: mailboxes.id })
    .from(mailboxes)
    .where(and(eq(mailboxes.workspaceId, workspaceId), eq(mailboxes.id, mailboxId)));
  if (!mb) throw new CampaignError("MAILBOX_NOT_FOUND", "That mailbox was not found.");
  const [identity] = await db
    .select({ id: sendingIdentities.id })
    .from(sendingIdentities)
    .where(and(eq(sendingIdentities.mailboxId, mailboxId), eq(sendingIdentities.isDefault, true)));
  return identity?.id ?? null;
}

export async function createCampaign(
  tx: AppDatabase,
  actor: { workspaceId: string; userId: string },
  input: unknown,
): Promise<string> {
  const v = campaignSettingsSchema.parse(input);
  const identityId = await assertRefs(tx, actor.workspaceId, v.audienceId, v.mailboxId);
  const [row] = await tx
    .insert(campaigns)
    .values({
      workspaceId: actor.workspaceId,
      ...settingsToColumns(v),
      sendingIdentityId: identityId,
      status: "DRAFT",
      createdBy: actor.userId,
    })
    .returning({ id: campaigns.id });
  return row!.id;
}

export async function updateCampaignSettings(
  tx: AppDatabase,
  actor: { workspaceId: string },
  campaignId: string,
  input: unknown,
): Promise<void> {
  const v = campaignSettingsSchema.parse(input);
  const identityId = await assertRefs(tx, actor.workspaceId, v.audienceId, v.mailboxId);
  const updated = await tx
    .update(campaigns)
    .set({ ...settingsToColumns(v), sendingIdentityId: identityId, updatedAt: new Date() })
    .where(
      and(
        eq(campaigns.workspaceId, actor.workspaceId),
        eq(campaigns.id, campaignId),
        eq(campaigns.status, "DRAFT"),
      ),
    )
    .returning({ id: campaigns.id });
  if (!updated.length)
    throw new CampaignError("NOT_EDITABLE", "Only draft campaigns can be edited.");
}

// ───────────────────────────── Sequence ─────────────────────────────

export const stepInputSchema = z.object({
  subject: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => v || null),
  body: z.string().trim().min(1, "Write the email text.").max(10_000),
  delayMinutes: z.coerce
    .number()
    .int()
    .min(0)
    .max(60 * 24 * 90),
  templateId: z.uuid().optional().nullable(),
});
export const stepsInputSchema = z.array(stepInputSchema).min(1, "Add at least one step.").max(10);

export type StepProblem = { step: number; field: "subject" | "body"; message: string };

/** Token and shape validation for a whole sequence (all problems, not just the first). */
export function validateSteps(steps: z.output<typeof stepsInputSchema>): StepProblem[] {
  const problems: StepProblem[] = [];
  steps.forEach((s, i) => {
    const n = i + 1;
    if (n === 1 && !s.subject)
      problems.push({ step: n, field: "subject", message: "The first email needs a subject." });
    if (s.subject)
      for (const issue of validateTemplateText(s.subject))
        problems.push({ step: n, field: "subject", message: issue.message });
    for (const issue of validateTemplateText(s.body))
      problems.push({ step: n, field: "body", message: issue.message });
  });
  return problems;
}

export async function saveSteps(
  tx: AppDatabase,
  actor: { workspaceId: string },
  campaignId: string,
  input: unknown,
): Promise<void> {
  const steps = stepsInputSchema.parse(input);
  const problems = validateSteps(steps);
  if (problems.length) throw new CampaignError("INVALID_STEPS", problems[0]!.message);
  const [c] = await tx
    .select({ status: campaigns.status })
    .from(campaigns)
    .where(and(eq(campaigns.workspaceId, actor.workspaceId), eq(campaigns.id, campaignId)))
    .for("update");
  if (!c) throw new CampaignError("NOT_FOUND", "Campaign not found.");
  if (c.status !== "DRAFT")
    throw new CampaignError(
      "NOT_EDITABLE",
      "The sequence can only be changed while the campaign is a draft.",
    );
  await tx.delete(sequenceSteps).where(eq(sequenceSteps.campaignId, campaignId));
  await tx.insert(sequenceSteps).values(
    steps.map((s, i) => ({
      workspaceId: actor.workspaceId,
      campaignId,
      stepNumber: i + 1,
      delayMinutes: i === 0 ? 0 : s.delayMinutes,
      threadMode: i === 0 || s.subject ? ("new" as const) : ("reply" as const),
      subject: s.subject,
      body: s.body,
      sourceTemplateId: s.templateId ?? null,
    })),
  );
  await tx.update(campaigns).set({ updatedAt: new Date() }).where(eq(campaigns.id, campaignId));
}

// ───────────────────────────── Read models ─────────────────────────────

export async function listCampaigns(db: AppDatabase, workspaceId: string) {
  return db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      status: campaigns.status,
      startAt: campaigns.startAt,
      launchedAt: campaigns.launchedAt,
      createdAt: campaigns.createdAt,
      audienceName: audiences.name,
      recipients: sql<number>`(select count(*)::int from app.campaign_recipients r where r.campaign_id = "app"."campaigns"."id" and r.status <> 'EXCLUDED')`,
      sent: sql<number>`(select count(*)::int from app.messages m where m.campaign_id = "app"."campaigns"."id" and m.status = 'SENT')`,
      replied: sql<number>`(select count(*)::int from app.campaign_recipients r where r.campaign_id = "app"."campaigns"."id" and r.status = 'REPLIED')`,
      steps: sql<number>`(select count(*)::int from app.sequence_steps s where s.campaign_id = "app"."campaigns"."id")`,
    })
    .from(campaigns)
    .leftJoin(audiences, eq(audiences.id, campaigns.audienceId))
    .where(and(eq(campaigns.workspaceId, workspaceId), isNull(campaigns.archivedAt)))
    .orderBy(desc(campaigns.createdAt));
}

export async function getCampaign(db: AppDatabase, workspaceId: string, campaignId: string) {
  const [c] = await db
    .select({
      campaign: campaigns,
      audienceName: audiences.name,
      mailboxEmail: mailboxes.emailAddress,
      mailboxName: mailboxes.displayName,
      mailboxStatus: mailboxes.status,
      mailboxEnabled: mailboxes.enabled,
    })
    .from(campaigns)
    .leftJoin(audiences, eq(audiences.id, campaigns.audienceId))
    .leftJoin(mailboxes, eq(mailboxes.id, campaigns.mailboxId))
    .where(and(eq(campaigns.workspaceId, workspaceId), eq(campaigns.id, campaignId)));
  if (!c) return null;
  const steps = await db
    .select()
    .from(sequenceSteps)
    .where(eq(sequenceSteps.campaignId, campaignId))
    .orderBy(asc(sequenceSteps.stepNumber));
  return { ...c, steps };
}

// ───────────────────────────── Enrollment plan (preview + launch) ─────────────────────────────

export type PlannedRecipient = {
  prospectId: string;
  email: string | null;
  companyName: string;
  contactName: string | null;
  decision: "enroll" | "excluded";
  /** Engine status, or the campaign-specific exclusion. */
  category:
    | "ELIGIBLE"
    | "NEEDS_REVIEW"
    | "INELIGIBLE"
    | "SUPPRESSED"
    | "MISSING_VARIABLE"
    | "ALREADY_ACTIVE";
  reasons: string[];
};

export type EnrollmentPlan = {
  members: number;
  recipients: PlannedRecipient[];
  counts: Record<PlannedRecipient["category"], number> & { enroll: number; excluded: number };
  blockers: string[];
};

type CampaignForPlan = {
  id: string;
  workspaceId: string;
  audienceId: string | null;
  mailboxId: string | null;
  status: string;
};

/** Sender name used for {{sender_name}}: the mailbox's default identity, else its display name. */
async function senderName(db: AppDatabase, mailboxId: string | null) {
  if (!mailboxId) return null;
  const [row] = await db
    .select({ fromName: sendingIdentities.fromName, displayName: mailboxes.displayName })
    .from(mailboxes)
    .leftJoin(
      sendingIdentities,
      and(eq(sendingIdentities.mailboxId, mailboxes.id), eq(sendingIdentities.isDefault, true)),
    )
    .where(eq(mailboxes.id, mailboxId));
  return row?.fromName ?? row?.displayName ?? null;
}

export async function planEnrollment(
  db: AppDatabase,
  campaign: CampaignForPlan,
  steps: ReadonlyArray<ComposeStep>,
  now = new Date(),
): Promise<EnrollmentPlan> {
  const counts = {
    ELIGIBLE: 0,
    NEEDS_REVIEW: 0,
    INELIGIBLE: 0,
    SUPPRESSED: 0,
    MISSING_VARIABLE: 0,
    ALREADY_ACTIVE: 0,
    enroll: 0,
    excluded: 0,
  };
  const blockers: string[] = [];
  if (!campaign.audienceId) blockers.push("Choose an audience.");
  if (!steps.length) blockers.push("Add at least one email to the sequence.");
  if (!campaign.audienceId) return { members: 0, recipients: [], counts, blockers };

  const members = await db
    .select({
      id: prospects.id,
      email: prospects.emailNormalized,
      firstName: prospects.firstName,
      lastName: prospects.lastName,
      contactName: prospects.contactName,
      contactTitle: prospects.contactTitle,
      companyName: prospects.companyName,
      businessType: prospects.businessType,
      city: prospects.city,
      state: prospects.state,
      countryCode: prospects.countryCode,
      websiteDomain: prospects.websiteDomain,
    })
    .from(audienceMembers)
    .innerJoin(prospects, eq(prospects.id, audienceMembers.prospectId))
    .where(
      and(
        eq(audienceMembers.workspaceId, campaign.workspaceId),
        eq(audienceMembers.audienceId, campaign.audienceId),
        isNull(prospects.archivedAt),
      ),
    )
    .orderBy(asc(prospects.companyName));

  const eligibility = await evaluateProspects(
    db,
    campaign.workspaceId,
    members.map((m) => m.id),
    now,
  );
  const sender = { name: await senderName(db, campaign.mailboxId) };
  const emails = members.map((m) => m.email).filter((e): e is string => Boolean(e));
  const active = emails.length
    ? await db
        .selectDistinct({ email: campaignRecipients.emailNormalized })
        .from(campaignRecipients)
        .innerJoin(campaigns, eq(campaigns.id, campaignRecipients.campaignId))
        .where(
          and(
            eq(campaignRecipients.workspaceId, campaign.workspaceId),
            ne(campaignRecipients.campaignId, campaign.id),
            inArray(campaignRecipients.status, ["QUEUED", "SCHEDULED", "SENDING"]),
            inArray(campaignRecipients.emailNormalized, emails),
          ),
        )
    : [];
  const busy = new Set(active.map((a) => a.email));
  const firstStep = steps[0];

  const recipients: PlannedRecipient[] = members.map((m) => {
    const result = eligibility.get(m.id) as EligibilityResult;
    const base = {
      prospectId: m.id,
      email: m.email,
      companyName: m.companyName,
      contactName: m.contactName,
    };
    if (result.status !== "ELIGIBLE")
      return { ...base, decision: "excluded", category: result.status, reasons: result.reasons };
    if (m.email && busy.has(m.email))
      return {
        ...base,
        decision: "excluded",
        category: "ALREADY_ACTIVE",
        reasons: ["ALREADY_IN_ACTIVE_CAMPAIGN"],
      };
    if (firstStep) {
      const values = prospectTokenValues(m, sender);
      const missing = new Set<string>();
      for (const step of steps) {
        const c = composeMessage({
          step,
          firstStep,
          values,
          policyFooter: null,
          postalAddress: null,
          requiresPostalAddress: false,
          unsubscribeUrl: "",
        });
        c.missing.forEach((x) => missing.add(x));
      }
      if (missing.size)
        return {
          ...base,
          decision: "excluded",
          category: "MISSING_VARIABLE",
          reasons: [...missing].map((t) => `MISSING_REQUIRED_VARIABLE:${t}`),
        };
    }
    return { ...base, decision: "enroll", category: "ELIGIBLE", reasons: [] };
  });

  for (const r of recipients) {
    counts[r.category]++;
    counts[r.decision === "enroll" ? "enroll" : "excluded"]++;
  }
  if (members.length === 0) blockers.push("The audience has no members.");
  else if (counts.enroll === 0) blockers.push("No audience member can be contacted right now.");
  return { members: members.length, recipients, counts, blockers };
}

/** Rendered example messages for preview (fictional/selected recipients from the plan). */
export async function previewMessages(
  db: AppDatabase,
  campaign: CampaignForPlan & { workspaceId: string },
  steps: ReadonlyArray<ComposeStep>,
  prospectIds: readonly string[],
) {
  if (!steps.length || !prospectIds.length) return [];
  const sender = { name: await senderName(db, campaign.mailboxId) };
  const [ws] = await db
    .select({ postal: workspaces.compliancePostalAddress })
    .from(workspaces)
    .where(eq(workspaces.id, campaign.workspaceId));
  const rowsFound = await db
    .select()
    .from(prospects)
    .where(
      and(eq(prospects.workspaceId, campaign.workspaceId), inArray(prospects.id, [...prospectIds])),
    );
  const eligibility = await evaluateProspects(db, campaign.workspaceId, prospectIds);
  return prospectIds
    .map((id) => rowsFound.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => {
      const policy = eligibility.get(p.id)?.jurisdiction;
      return {
        prospectId: p.id,
        companyName: p.companyName,
        contactName: p.contactName,
        email: p.emailNormalized,
        messages: steps.map((step) =>
          composeMessage({
            step,
            firstStep: steps[0]!,
            values: prospectTokenValues(p, sender),
            policyFooter: policy?.footerTemplate ?? null,
            postalAddress: ws?.postal ?? null,
            requiresPostalAddress: policy?.requiresPostalAddress ?? true,
            unsubscribeUrl: "[personal unsubscribe link]",
          }),
        ),
      };
    });
}

// ───────────────────────────── Launch and transitions ─────────────────────────────

export type LaunchChecks = { problems: string[] };

/** Everything that must be true before a campaign may start (beyond recipient eligibility). */
export async function launchProblems(
  db: AppDatabase,
  workspaceId: string,
  c: {
    mailboxId: string | null;
    mailboxStatus: string | null;
    mailboxEnabled: boolean | null;
  },
  opts: { unsubscribeConfigured: boolean },
): Promise<string[]> {
  const problems: string[] = [];
  if (!c.mailboxId) problems.push("Choose a sending mailbox.");
  else if (c.mailboxStatus !== "CONNECTED" || !c.mailboxEnabled)
    problems.push("The sending mailbox is not available (it must be connected and enabled).");
  if (!opts.unsubscribeConfigured)
    problems.push(
      "Unsubscribe links are not configured (UNSUBSCRIBE_SIGNING_SECRET). Every email must carry one.",
    );
  const [ws] = await db
    .select({ postal: workspaces.compliancePostalAddress })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  if (!ws?.postal?.trim())
    problems.push(
      "The workspace postal address is not set. Outreach policies require it in every email footer.",
    );
  return problems;
}

export async function launchCampaign(
  tx: AppDatabase,
  actor: { workspaceId: string; userId: string },
  campaignId: string,
  opts: { unsubscribeConfigured: boolean },
  now = new Date(),
): Promise<{ status: "SCHEDULED" | "ACTIVE"; enrolled: number; excluded: number }> {
  const found = await getCampaign(tx, actor.workspaceId, campaignId);
  if (!found) throw new CampaignError("NOT_FOUND", "Campaign not found.");
  const c = found.campaign;
  if (!canTransition(c.status, "launch"))
    throw new CampaignError("BAD_STATE", "Only a draft campaign can be launched.");
  const problems = await launchProblems(
    tx,
    actor.workspaceId,
    {
      mailboxId: c.mailboxId,
      mailboxStatus: found.mailboxStatus,
      mailboxEnabled: found.mailboxEnabled,
    },
    opts,
  );
  const steps = found.steps.filter((s) => s.enabled);
  const plan = await planEnrollment(tx, c, steps, now);
  const all = [...problems, ...plan.blockers];
  if (all.length) throw new CampaignError("NOT_READY", all[0]!);

  // Claim the campaign first so two launches cannot both enroll.
  const startAt = c.startAt && c.startAt > now ? c.startAt : now;
  const status = c.startAt && c.startAt > now ? "SCHEDULED" : "ACTIVE";
  const claimed = await tx
    .update(campaigns)
    .set({
      status,
      launchedAt: now,
      launchedBy: actor.userId,
      startAt,
      version: sql`${campaigns.version} + 1`,
      updatedAt: now,
    })
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.status, "DRAFT")))
    .returning({ id: campaigns.id });
  if (!claimed.length) throw new CampaignError("BAD_STATE", "The campaign was already launched.");

  const firstStep = steps[0]!.stepNumber;
  for (let i = 0; i < plan.recipients.length; i += 500) {
    const chunk = plan.recipients
      .slice(i, i + 500)
      .filter((r) => r.email || r.decision === "excluded");
    if (!chunk.length) continue;
    await tx.insert(campaignRecipients).values(
      chunk.map((r) =>
        r.decision === "enroll"
          ? {
              workspaceId: actor.workspaceId,
              campaignId,
              prospectId: r.prospectId,
              emailNormalized: r.email!,
              status: "SCHEDULED" as const,
              nextStep: firstStep,
              nextSendAt: startAt,
              enrolledBy: actor.userId,
            }
          : {
              workspaceId: actor.workspaceId,
              campaignId,
              prospectId: r.prospectId,
              emailNormalized: r.email ?? "",
              status: "EXCLUDED" as const,
              excludedReasons: r.reasons,
              enrolledBy: actor.userId,
            },
      ),
    );
  }
  return { status, enrolled: plan.counts.enroll, excluded: plan.counts.excluded };
}

export async function transitionCampaign(
  tx: AppDatabase,
  actor: { workspaceId: string; userId: string },
  campaignId: string,
  action: Exclude<CampaignAction, "launch">,
  now = new Date(),
): Promise<string> {
  const [c] = await tx
    .select({ status: campaigns.status, startAt: campaigns.startAt })
    .from(campaigns)
    .where(and(eq(campaigns.workspaceId, actor.workspaceId), eq(campaigns.id, campaignId)));
  if (!c) throw new CampaignError("NOT_FOUND", "Campaign not found.");
  if (!canTransition(c.status, action))
    throw new CampaignError(
      "BAD_STATE",
      `A ${c.status.toLowerCase()} campaign cannot be ${action === "stop" ? "stopped" : `${action}d`}.`,
    );

  const target =
    action === "pause"
      ? "PAUSED"
      : action === "stop"
        ? "CANCELLED"
        : c.startAt && c.startAt > now
          ? "SCHEDULED"
          : "ACTIVE";
  const updated = await tx
    .update(campaigns)
    .set({
      status: target,
      pausedAt: action === "pause" ? now : action === "resume" ? null : undefined,
      pauseReason:
        action === "pause" ? "Paused by an operator" : action === "resume" ? null : undefined,
      cancelledAt: action === "stop" ? now : undefined,
      updatedAt: now,
    })
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.status, c.status)))
    .returning({ id: campaigns.id });
  if (!updated.length)
    throw new CampaignError("BAD_STATE", "The campaign changed meanwhile. Reload and try again.");
  if (action === "stop")
    await haltRecipients(
      tx,
      { kind: "campaign", workspaceId: actor.workspaceId, campaignId },
      "CANCELLED",
      "CAMPAIGN_STOPPED",
      now,
      actor.userId,
      { cancelMessages: false },
    );
  return target;
}

// ───────────────────────────── Results ─────────────────────────────

export async function campaignResults(db: AppDatabase, workspaceId: string, campaignId: string) {
  const byStatus = await db
    .select({ status: campaignRecipients.status, n: sql<number>`count(*)::int` })
    .from(campaignRecipients)
    .where(
      and(
        eq(campaignRecipients.workspaceId, workspaceId),
        eq(campaignRecipients.campaignId, campaignId),
      ),
    )
    .groupBy(campaignRecipients.status);
  const s = Object.fromEntries(byStatus.map((r) => [r.status, r.n])) as Record<string, number>;
  const get = (k: string) => s[k] ?? 0;
  const msgs = await db
    .select({ status: messages.status, n: sql<number>`count(*)::int` })
    .from(messages)
    .where(and(eq(messages.workspaceId, workspaceId), eq(messages.campaignId, campaignId)))
    .groupBy(messages.status);
  const m = Object.fromEntries(msgs.map((r) => [r.status, r.n])) as Record<string, number>;
  const [positive] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(replyThreads)
    .where(
      and(
        eq(replyThreads.workspaceId, workspaceId),
        eq(replyThreads.campaignId, campaignId),
        eq(replyThreads.classification, "INTERESTED"),
      ),
    );
  const [contacted] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(campaignRecipients)
    .where(
      and(
        eq(campaignRecipients.workspaceId, workspaceId),
        eq(campaignRecipients.campaignId, campaignId),
        sql`${campaignRecipients.lastSentStep} > 0`,
      ),
    );
  const total = byStatus.reduce((a, r) => a + r.n, 0);
  return {
    recipients: total - get("EXCLUDED"),
    excluded: get("EXCLUDED"),
    sent: m.SENT ?? 0,
    /** Prospects who received at least one email (reply-rate denominator). */
    contacted: contacted?.n ?? 0,
    replied: get("REPLIED"),
    positive: positive?.n ?? 0,
    bounced: get("BOUNCED"),
    unsubscribed: get("UNSUBSCRIBED"),
    suppressed: get("SUPPRESSED"),
    stopped: get("STOPPED") + get("CANCELLED") + get("FAILED"),
    completed: get("COMPLETED"),
    remaining: get("QUEUED") + get("SCHEDULED") + get("SENDING"),
    needsReview: (m.RECONCILIATION_REQUIRED ?? 0) + (m.OPERATOR_REVIEW ?? 0),
  };
}

export const RECIPIENT_FILTERS = ["all", "live", "replied", "stopped", "excluded"] as const;

export async function listRecipients(
  db: AppDatabase,
  workspaceId: string,
  campaignId: string,
  filter: (typeof RECIPIENT_FILTERS)[number],
  page: number,
  size = 50,
) {
  const statusFilter =
    filter === "live"
      ? inArray(campaignRecipients.status, ["QUEUED", "SCHEDULED", "SENDING"])
      : filter === "replied"
        ? eq(campaignRecipients.status, "REPLIED")
        : filter === "stopped"
          ? inArray(campaignRecipients.status, [
              "BOUNCED",
              "UNSUBSCRIBED",
              "SUPPRESSED",
              "STOPPED",
              "FAILED",
              "CANCELLED",
            ])
          : filter === "excluded"
            ? eq(campaignRecipients.status, "EXCLUDED")
            : undefined;
  const where = and(
    eq(campaignRecipients.workspaceId, workspaceId),
    eq(campaignRecipients.campaignId, campaignId),
    statusFilter,
  );
  const [{ total } = { total: 0 }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(campaignRecipients)
    .where(where);
  const list = await db
    .select({
      id: campaignRecipients.id,
      prospectId: campaignRecipients.prospectId,
      email: campaignRecipients.emailNormalized,
      status: campaignRecipients.status,
      lastSentStep: campaignRecipients.lastSentStep,
      nextStep: campaignRecipients.nextStep,
      nextSendAt: campaignRecipients.nextSendAt,
      stopReason: campaignRecipients.stopReason,
      excludedReasons: campaignRecipients.excludedReasons,
      lastSentAt: campaignRecipients.lastSentAt,
      companyName: prospects.companyName,
      contactName: prospects.contactName,
      lastMessageId: sql<
        string | null
      >`(select m.id from app.messages m where m.campaign_recipient_id = "app"."campaign_recipients"."id" and m.status = 'SENT' order by m.step_number desc limit 1)`,
    })
    .from(campaignRecipients)
    .innerJoin(prospects, eq(prospects.id, campaignRecipients.prospectId))
    .where(where)
    .orderBy(asc(prospects.companyName), asc(campaignRecipients.id))
    .limit(size)
    .offset((page - 1) * size);
  return { total, rows: list };
}

/** Messages for one campaign that need an operator (ambiguous sends). */
export async function messagesNeedingReview(
  db: AppDatabase,
  workspaceId: string,
  campaignId: string,
) {
  return db
    .select({
      id: messages.id,
      toEmail: messages.toEmail,
      stepNumber: messages.stepNumber,
      status: messages.status,
      errorCode: messages.errorCode,
      updatedAt: messages.updatedAt,
    })
    .from(messages)
    .where(
      and(
        eq(messages.workspaceId, workspaceId),
        eq(messages.campaignId, campaignId),
        inArray(messages.status, ["RECONCILIATION_REQUIRED", "OPERATOR_REVIEW"]),
      ),
    )
    .orderBy(asc(messages.updatedAt));
}
