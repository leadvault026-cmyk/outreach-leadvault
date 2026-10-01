import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  EVENT_SOURCES,
  MATCH_METHODS,
  MESSAGE_EVENT_TYPES,
  MESSAGE_KINDS,
  MESSAGE_RESOLUTIONS,
  MESSAGE_STATUSES,
  REPLY_KINDS,
  SEND_ATTEMPT_RESULTS,
  THREAD_CLASSIFICATIONS,
} from "@/domain/enums";
import { appSchema, id, inList, timestamps, timestamptz } from "./_shared";
import { campaignRecipients, campaigns, sequenceSteps } from "./campaigns";
import { mailboxes, sendingIdentities } from "./mailboxes";
import { prospects } from "./prospects";

/**
 * Architecture §4.9 / §11 / §12. Outbound messages — also the send OUTBOX.
 * The partial unique index on (campaign_recipient_id, step_number) is the duplicate-send guard.
 */
export const messages = appSchema.table(
  "messages",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull(),
    kind: text("kind", { enum: MESSAGE_KINDS }).notNull(),
    campaignId: uuid("campaign_id"),
    campaignRecipientId: uuid("campaign_recipient_id"),
    sequenceStepId: uuid("sequence_step_id"),
    stepNumber: integer("step_number"),
    prospectId: uuid("prospect_id"),
    mailboxId: uuid("mailbox_id").notNull(),
    sendingIdentityId: uuid("sending_identity_id"),
    toEmail: text("to_email").notNull(),
    fromEmail: text("from_email").notNull(),
    fromName: text("from_name"),
    subject: text("subject").notNull(),
    bodyText: text("body_text").notNull(),
    rfcMessageId: text("rfc_message_id").notNull().unique(),
    lvMessageHeader: text("lv_message_header").notNull().unique(),
    inReplyTo: text("in_reply_to"),
    referencesHeader: text("references_header"),
    providerMessageId: text("provider_message_id"),
    providerThreadId: text("provider_thread_id"),
    status: text("status", { enum: MESSAGE_STATUSES }).notNull(),
    scheduledFor: timestamptz("scheduled_for").notNull(),
    nextAttemptAt: timestamptz("next_attempt_at"),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamptz("lease_expires_at"),
    attemptCount: integer("attempt_count").notNull().default(0),
    reconciliationChecks: integer("reconciliation_checks").notNull().default(0),
    reconciliationNextAt: timestamptz("reconciliation_next_at"),
    resolution: text("resolution", { enum: MESSAGE_RESOLUTIONS }),
    resolvedBy: uuid("resolved_by"),
    resolvedAt: timestamptz("resolved_at"),
    sentAt: timestamptz("sent_at"),
    failedAt: timestamptz("failed_at"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    bouncedAt: timestamptz("bounced_at"),
    bounceType: text("bounce_type"),
    ...timestamps,
  },
  (t) => [
    unique("messages_workspace_id_id_key").on(t.workspaceId, t.id),
    foreignKey({
      name: "messages_recipient_fk",
      columns: [t.workspaceId, t.campaignRecipientId],
      foreignColumns: [campaignRecipients.workspaceId, campaignRecipients.id],
    }),
    foreignKey({
      name: "messages_campaign_fk",
      columns: [t.workspaceId, t.campaignId],
      foreignColumns: [campaigns.workspaceId, campaigns.id],
    }),
    foreignKey({
      name: "messages_step_fk",
      columns: [t.workspaceId, t.sequenceStepId],
      foreignColumns: [sequenceSteps.workspaceId, sequenceSteps.id],
    }),
    foreignKey({
      name: "messages_prospect_fk",
      columns: [t.workspaceId, t.prospectId],
      foreignColumns: [prospects.workspaceId, prospects.id],
    }),
    foreignKey({
      name: "messages_mailbox_fk",
      columns: [t.workspaceId, t.mailboxId],
      foreignColumns: [mailboxes.workspaceId, mailboxes.id],
    }),
    foreignKey({
      name: "messages_sending_identity_fk",
      columns: [t.workspaceId, t.sendingIdentityId],
      foreignColumns: [sendingIdentities.workspaceId, sendingIdentities.id],
    }),
    uniqueIndex("messages_recipient_step_uq")
      .on(t.campaignRecipientId, t.stepNumber)
      .where(sql`${t.kind} = 'sequence'`),
    index("messages_executor_idx")
      .on(t.mailboxId, t.scheduledFor)
      .where(sql`${t.status} in ('PENDING', 'RETRY_WAIT')`),
    index("messages_lease_idx")
      .on(t.leaseExpiresAt)
      .where(sql`${t.status} = 'SENDING'`),
    index("messages_reconciliation_idx")
      .on(t.reconciliationNextAt)
      .where(sql`${t.status} = 'RECONCILIATION_REQUIRED'`),
    index("messages_operator_review_idx")
      .on(t.workspaceId, t.mailboxId)
      .where(sql`${t.status} = 'OPERATOR_REVIEW'`),
    index("messages_campaign_sent_idx").on(t.campaignId, t.sentAt),
    index("messages_mailbox_sent_idx").on(t.mailboxId, t.sentAt),
    index("messages_ws_sent_idx").on(t.workspaceId, t.sentAt),
    index("messages_provider_thread_idx").on(t.providerThreadId),
    check("messages_kind_check", inList(t.kind, MESSAGE_KINDS)),
    check("messages_status_check", inList(t.status, MESSAGE_STATUSES)),
    check(
      "messages_resolution_check",
      sql`${t.resolution} is null or ${inList(t.resolution, MESSAGE_RESOLUTIONS)}`,
    ),
    check(
      "messages_sequence_shape_check",
      sql`${t.kind} <> 'sequence' or (${t.campaignId} is not null and ${t.campaignRecipientId} is not null and ${t.stepNumber} is not null)`,
    ),
    check("messages_sent_at_check", sql`${t.status} <> 'SENT' or ${t.sentAt} is not null`),
    check(
      "messages_attempts_check",
      sql`${t.attemptCount} >= 0 and ${t.reconciliationChecks} >= 0`,
    ),
  ],
);

/** Service-only (no workspace_id); exposed later through message detail views via the DAL. */
export const sendAttempts = appSchema.table(
  "send_attempts",
  {
    id: id(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id),
    attemptNumber: integer("attempt_number").notNull(),
    workerId: text("worker_id").notNull(),
    startedAt: timestamptz("started_at").notNull(),
    finishedAt: timestamptz("finished_at"),
    mailboxHistoryIdBefore: text("mailbox_history_id_before"),
    requestDispatched: boolean("request_dispatched").notNull().default(false),
    result: text("result", { enum: SEND_ATTEMPT_RESULTS }),
    providerStatus: integer("provider_status"),
    errorCode: text("error_code"),
    errorDetail: text("error_detail"),
  },
  (t) => [
    unique("send_attempts_message_attempt_key").on(t.messageId, t.attemptNumber),
    check(
      "send_attempts_result_check",
      sql`${t.result} is null or ${inList(t.result, SEND_ATTEMPT_RESULTS)}`,
    ),
    check("send_attempts_number_check", sql`${t.attemptNumber} >= 1`),
  ],
);

export const messageEvents = appSchema.table(
  "message_events",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull(),
    messageId: uuid("message_id"),
    campaignRecipientId: uuid("campaign_recipient_id"),
    eventType: text("event_type", { enum: MESSAGE_EVENT_TYPES }).notNull(),
    occurredAt: timestamptz("occurred_at").notNull(),
    source: text("source", { enum: EVENT_SOURCES }).notNull(),
    dedupeKey: text("dedupe_key").notNull().unique(),
    webhookEventId: uuid("webhook_event_id"),
    inboundMessageId: uuid("inbound_message_id"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "message_events_message_fk",
      columns: [t.workspaceId, t.messageId],
      foreignColumns: [messages.workspaceId, messages.id],
    }),
    foreignKey({
      name: "message_events_recipient_fk",
      columns: [t.workspaceId, t.campaignRecipientId],
      foreignColumns: [campaignRecipients.workspaceId, campaignRecipients.id],
    }),
    index("message_events_ws_type_idx").on(t.workspaceId, t.eventType, t.occurredAt),
    index("message_events_message_idx").on(t.messageId),
    check("message_events_type_check", inList(t.eventType, MESSAGE_EVENT_TYPES)),
    check("message_events_source_check", inList(t.source, EVENT_SOURCES)),
  ],
);

/** Architecture §4.10 / §16. */
export const replyThreads = appSchema.table(
  "reply_threads",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull(),
    mailboxId: uuid("mailbox_id").notNull(),
    providerThreadId: text("provider_thread_id").notNull(),
    campaignId: uuid("campaign_id"),
    campaignRecipientId: uuid("campaign_recipient_id"),
    prospectId: uuid("prospect_id"),
    subject: text("subject"),
    classification: text("classification", { enum: THREAD_CLASSIFICATIONS })
      .notNull()
      .default("UNREVIEWED"),
    classifiedBy: uuid("classified_by"),
    classifiedAt: timestamptz("classified_at"),
    isUnread: boolean("is_unread").notNull().default(true),
    archivedAt: timestamptz("archived_at"),
    lastMessageAt: timestamptz("last_message_at").notNull(),
    ...timestamps,
  },
  (t) => [
    unique("reply_threads_workspace_id_id_key").on(t.workspaceId, t.id),
    unique("reply_threads_mailbox_thread_key").on(t.mailboxId, t.providerThreadId),
    foreignKey({
      name: "reply_threads_mailbox_fk",
      columns: [t.workspaceId, t.mailboxId],
      foreignColumns: [mailboxes.workspaceId, mailboxes.id],
    }),
    foreignKey({
      name: "reply_threads_campaign_fk",
      columns: [t.workspaceId, t.campaignId],
      foreignColumns: [campaigns.workspaceId, campaigns.id],
    }),
    foreignKey({
      name: "reply_threads_recipient_fk",
      columns: [t.workspaceId, t.campaignRecipientId],
      foreignColumns: [campaignRecipients.workspaceId, campaignRecipients.id],
    }),
    foreignKey({
      name: "reply_threads_prospect_fk",
      columns: [t.workspaceId, t.prospectId],
      foreignColumns: [prospects.workspaceId, prospects.id],
    }),
    index("reply_threads_ws_class_idx").on(t.workspaceId, t.classification, t.lastMessageAt.desc()),
    index("reply_threads_ws_campaign_idx").on(t.workspaceId, t.campaignId, t.lastMessageAt.desc()),
    check("reply_threads_classification_check", inList(t.classification, THREAD_CLASSIFICATIONS)),
  ],
);

export const replies = appSchema.table(
  "replies",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull(),
    mailboxId: uuid("mailbox_id").notNull(),
    replyThreadId: uuid("reply_thread_id"),
    providerMessageId: text("provider_message_id").notNull(),
    rfcMessageId: text("rfc_message_id"),
    inReplyTo: text("in_reply_to"),
    referencesHeader: text("references_header"),
    fromEmail: text("from_email").notNull(),
    fromName: text("from_name"),
    toEmails: text("to_emails").array(),
    subject: text("subject"),
    snippet: text("snippet"),
    bodyText: text("body_text"),
    bodyHtmlSanitized: text("body_html_sanitized"),
    receivedAt: timestamptz("received_at").notNull(),
    kind: text("kind", { enum: REPLY_KINDS }).notNull(),
    matchedMessageId: uuid("matched_message_id"),
    matchMethod: text("match_method", { enum: MATCH_METHODS }),
    processedAt: timestamptz("processed_at"),
    rawHeaders: jsonb("raw_headers").$type<Record<string, string>>(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("replies_mailbox_provider_message_key").on(t.mailboxId, t.providerMessageId),
    foreignKey({
      name: "replies_mailbox_fk",
      columns: [t.workspaceId, t.mailboxId],
      foreignColumns: [mailboxes.workspaceId, mailboxes.id],
    }),
    foreignKey({
      name: "replies_thread_fk",
      columns: [t.workspaceId, t.replyThreadId],
      foreignColumns: [replyThreads.workspaceId, replyThreads.id],
    }),
    foreignKey({
      name: "replies_matched_message_fk",
      columns: [t.workspaceId, t.matchedMessageId],
      foreignColumns: [messages.workspaceId, messages.id],
    }),
    index("replies_thread_idx").on(t.replyThreadId, t.receivedAt),
    index("replies_ws_received_idx").on(t.workspaceId, t.receivedAt.desc()),
    check("replies_kind_check", inList(t.kind, REPLY_KINDS)),
    check(
      "replies_match_method_check",
      sql`${t.matchMethod} is null or ${inList(t.matchMethod, MATCH_METHODS)}`,
    ),
  ],
);
