import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  foreignKey,
  index,
  integer,
  smallint,
  text,
  time,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import {
  CAMPAIGN_STATUSES,
  OUTCOME_SOURCES,
  OUTCOMES,
  RECIPIENT_STATUSES,
  THREAD_MODES,
} from "@/domain/enums";
import { appSchema, id, inList, timestamps, timestamptz } from "./_shared";
import { audiences, templates } from "./audiences";
import { mailboxes, sendingIdentities } from "./mailboxes";
import { prospects } from "./prospects";
import { workspaces } from "./tenancy";

/** Architecture §4.8 / §9. */
export const campaigns = appSchema.table(
  "campaigns",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    name: text("name").notNull(),
    description: text("description"),
    objective: text("objective"),
    status: text("status", { enum: CAMPAIGN_STATUSES }).notNull().default("DRAFT"),
    audienceId: uuid("audience_id"),
    mailboxId: uuid("mailbox_id"),
    sendingIdentityId: uuid("sending_identity_id"),
    timezone: text("timezone"),
    sendDays: smallint("send_days").array(),
    windowStart: time("window_start"),
    windowEnd: time("window_end"),
    dailyLimit: integer("daily_limit"),
    minSecondsBetweenSends: integer("min_seconds_between_sends"),
    continueOnAutoReply: boolean("continue_on_auto_reply").notNull().default(true),
    targetCountryCodes: char("target_country_codes", { length: 2 }).array(),
    startAt: timestamptz("start_at"),
    launchedAt: timestamptz("launched_at"),
    launchedBy: uuid("launched_by"),
    pausedAt: timestamptz("paused_at"),
    pauseReason: text("pause_reason"),
    completedAt: timestamptz("completed_at"),
    cancelledAt: timestamptz("cancelled_at"),
    version: integer("version").notNull().default(1),
    archivedAt: timestamptz("archived_at"),
    createdBy: uuid("created_by"),
    ...timestamps,
  },
  (t) => [
    unique("campaigns_workspace_id_id_key").on(t.workspaceId, t.id),
    foreignKey({
      name: "campaigns_mailbox_fk",
      columns: [t.workspaceId, t.mailboxId],
      foreignColumns: [mailboxes.workspaceId, mailboxes.id],
    }),
    foreignKey({
      name: "campaigns_sending_identity_fk",
      columns: [t.workspaceId, t.sendingIdentityId],
      foreignColumns: [sendingIdentities.workspaceId, sendingIdentities.id],
    }),
    foreignKey({
      name: "campaigns_audience_fk",
      columns: [t.workspaceId, t.audienceId],
      foreignColumns: [audiences.workspaceId, audiences.id],
    }),
    index("campaigns_ws_status_idx").on(t.workspaceId, t.status),
    index("campaigns_ws_created_idx").on(t.workspaceId, t.createdAt.desc()),
    index("campaigns_live_mailbox_idx")
      .on(t.mailboxId)
      .where(sql`${t.status} in ('SCHEDULED', 'ACTIVE', 'PAUSED')`),
    check("campaigns_status_check", inList(t.status, CAMPAIGN_STATUSES)),
    check("campaigns_daily_limit_check", sql`${t.dailyLimit} is null or ${t.dailyLimit} > 0`),
    check(
      "campaigns_window_check",
      sql`${t.windowStart} is null or ${t.windowEnd} is null or ${t.windowStart} < ${t.windowEnd}`,
    ),
    check("campaigns_version_check", sql`${t.version} >= 1`),
  ],
);

/** Campaign-owned SNAPSHOT of sequence content (templates are provenance only). */
export const sequenceSteps = appSchema.table(
  "sequence_steps",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull(),
    campaignId: uuid("campaign_id").notNull(),
    stepNumber: integer("step_number").notNull(),
    delayMinutes: integer("delay_minutes").notNull().default(0),
    threadMode: text("thread_mode", { enum: THREAD_MODES }).notNull().default("reply"),
    subject: text("subject"),
    body: text("body").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    sourceTemplateId: uuid("source_template_id"),
    ...timestamps,
  },
  (t) => [
    unique("sequence_steps_workspace_id_id_key").on(t.workspaceId, t.id),
    unique("sequence_steps_campaign_step_key").on(t.campaignId, t.stepNumber),
    foreignKey({
      name: "sequence_steps_campaign_fk",
      columns: [t.workspaceId, t.campaignId],
      foreignColumns: [campaigns.workspaceId, campaigns.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "sequence_steps_template_fk",
      columns: [t.workspaceId, t.sourceTemplateId],
      foreignColumns: [templates.workspaceId, templates.id],
    }),
    check("sequence_steps_step_number_check", sql`${t.stepNumber} >= 1`),
    check("sequence_steps_delay_check", sql`${t.delayMinutes} >= 0`),
    check("sequence_steps_thread_mode_check", inList(t.threadMode, THREAD_MODES)),
    check(
      "sequence_steps_subject_check",
      sql`${t.subject} is not null or (${t.threadMode} = 'reply' and ${t.stepNumber} > 1)`,
    ),
  ],
);

export const campaignRecipients = appSchema.table(
  "campaign_recipients",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull(),
    campaignId: uuid("campaign_id").notNull(),
    prospectId: uuid("prospect_id").notNull(),
    emailNormalized: text("email_normalized").notNull(),
    status: text("status", { enum: RECIPIENT_STATUSES }).notNull(),
    lastSentStep: integer("last_sent_step").notNull().default(0),
    nextStep: integer("next_step"),
    nextSendAt: timestamptz("next_send_at"),
    providerThreadId: text("provider_thread_id"),
    firstMessageRfcId: text("first_message_rfc_id"),
    stopReason: text("stop_reason"),
    stoppedAt: timestamptz("stopped_at"),
    stoppedBy: uuid("stopped_by"),
    excludedReasons: text("excluded_reasons").array(),
    outcome: text("outcome", { enum: OUTCOMES }),
    enrolledAt: timestamptz("enrolled_at").notNull().defaultNow(),
    enrolledBy: uuid("enrolled_by"),
    lastSentAt: timestamptz("last_sent_at"),
    repliedAt: timestamptz("replied_at"),
    ...timestamps,
  },
  (t) => [
    unique("campaign_recipients_workspace_id_id_key").on(t.workspaceId, t.id),
    unique("campaign_recipients_campaign_prospect_key").on(t.campaignId, t.prospectId),
    foreignKey({
      name: "campaign_recipients_campaign_fk",
      columns: [t.workspaceId, t.campaignId],
      foreignColumns: [campaigns.workspaceId, campaigns.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "campaign_recipients_prospect_fk",
      columns: [t.workspaceId, t.prospectId],
      foreignColumns: [prospects.workspaceId, prospects.id],
    }).onDelete("restrict"),
    index("campaign_recipients_due_idx")
      .on(t.nextSendAt)
      .where(sql`${t.status} = 'SCHEDULED'`),
    index("campaign_recipients_campaign_status_idx").on(t.campaignId, t.status),
    index("campaign_recipients_ws_email_idx").on(t.workspaceId, t.emailNormalized),
    index("campaign_recipients_prospect_idx").on(t.prospectId),
    check("campaign_recipients_status_check", inList(t.status, RECIPIENT_STATUSES)),
    check(
      "campaign_recipients_outcome_check",
      sql`${t.outcome} is null or ${inList(t.outcome, OUTCOMES)}`,
    ),
    check("campaign_recipients_last_step_check", sql`${t.lastSentStep} >= 0`),
    check(
      "campaign_recipients_scheduled_check",
      sql`${t.status} <> 'SCHEDULED' or (${t.nextStep} is not null and ${t.nextSendAt} is not null)`,
    ),
  ],
);

/** Append-only outcome history; current outcome is denormalized on campaign_recipients. */
export const campaignOutcomes = appSchema.table(
  "campaign_outcomes",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull(),
    campaignRecipientId: uuid("campaign_recipient_id").notNull(),
    campaignId: uuid("campaign_id").notNull(),
    outcome: text("outcome", { enum: OUTCOMES }).notNull(),
    source: text("source", { enum: OUTCOME_SOURCES }).notNull(),
    setBy: uuid("set_by"),
    note: text("note"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "campaign_outcomes_recipient_fk",
      columns: [t.workspaceId, t.campaignRecipientId],
      foreignColumns: [campaignRecipients.workspaceId, campaignRecipients.id],
    }),
    foreignKey({
      name: "campaign_outcomes_campaign_fk",
      columns: [t.workspaceId, t.campaignId],
      foreignColumns: [campaigns.workspaceId, campaigns.id],
    }),
    index("campaign_outcomes_campaign_idx").on(t.campaignId, t.createdAt),
    check("campaign_outcomes_outcome_check", inList(t.outcome, OUTCOMES)),
    check("campaign_outcomes_source_check", inList(t.source, OUTCOME_SOURCES)),
  ],
);
