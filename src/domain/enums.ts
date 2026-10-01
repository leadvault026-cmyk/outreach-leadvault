/**
 * Domain value sets. Each list is the single source of truth for a status/enum:
 * the database CHECK constraints (src/db/schema) and the application both read from here.
 * Architecture §4.1: text + CHECK instead of Postgres ENUM types.
 */

export const WORKSPACE_ROLES = ["OWNER", "ADMIN", "OPERATOR", "VIEWER"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const MEMBER_STATUSES = ["invited", "active", "disabled"] as const;
export const WORKSPACE_KINDS = ["internal", "client"] as const;

export const ELIGIBILITY_STATUSES = ["ELIGIBLE", "INELIGIBLE", "SUPPRESSED", "NEEDS_REVIEW"] as const;
export type EligibilityStatus = (typeof ELIGIBILITY_STATUSES)[number];

/** Email verification (architecture §14.7.5; Phase 1 brief §23). */
export const EMAIL_VERIFICATION_STATUSES = [
  "VERIFIED",
  "INVALID",
  "RISKY",
  "UNKNOWN",
  "STALE",
] as const;
export type EmailVerificationStatus = (typeof EMAIL_VERIFICATION_STATUSES)[number];

export const IMPORT_STATUSES = [
  "uploaded",
  "parsed",
  "mapped",
  "validating",
  "ready",
  "importing",
  "completed",
  "failed",
  "cancelled",
] as const;

export const IMPORT_ROW_OUTCOMES = [
  "pending",
  "create",
  "update",
  "unchanged",
  "duplicate_in_file",
  "duplicate_existing",
  "invalid",
  "suppressed",
  "skipped",
] as const;

export const AUDIENCE_MEMBER_SOURCES = ["manual", "import", "filter"] as const;
export const CUSTOM_FIELD_TYPES = ["text", "number", "date", "url"] as const;

export const PROVIDERS = ["smtp_imap", "google_workspace", "microsoft_365"] as const;
export type ProviderKind = (typeof PROVIDERS)[number];

export const PROVIDER_CONNECTION_STATUSES = ["active", "needs_reauth", "revoked", "error"] as const;
export const INGESTION_MODES = ["provider_api", "inbound_routing"] as const;

export const MAILBOX_STATUSES = ["CONNECTED", "NEEDS_ATTENTION", "PAUSED", "DISCONNECTED"] as const;
export type MailboxStatus = (typeof MAILBOX_STATUSES)[number];
export const WARMUP_STATUSES = ["warming", "ready", "paused"] as const;

export const CAMPAIGN_STATUSES = [
  "DRAFT",
  "SCHEDULED",
  "ACTIVE",
  "PAUSED",
  "COMPLETED",
  "CANCELLED",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const THREAD_MODES = ["new", "reply"] as const;

export const RECIPIENT_STATUSES = [
  "QUEUED",
  "SCHEDULED",
  "SENDING",
  "COMPLETED",
  "REPLIED",
  "BOUNCED",
  "UNSUBSCRIBED",
  "SUPPRESSED",
  "STOPPED",
  "FAILED",
  "CANCELLED",
  "EXCLUDED",
] as const;
export type RecipientStatus = (typeof RECIPIENT_STATUSES)[number];

export const OUTCOMES = [
  "INTERESTED",
  "NOT_INTERESTED",
  "FOLLOW_UP",
  "OUT_OF_OFFICE",
  "UNSUBSCRIBE",
  "OTHER",
] as const;
export const OUTCOME_SOURCES = ["inbox_classification", "manual", "system"] as const;

export const MESSAGE_KINDS = ["sequence", "manual_reply", "test"] as const;
export const MESSAGE_STATUSES = [
  "PENDING",
  "SENDING",
  "RETRY_WAIT",
  "RECONCILIATION_REQUIRED",
  "OPERATOR_REVIEW",
  "SENT",
  "FAILED",
  "CANCELLED",
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const MESSAGE_RESOLUTIONS = [
  "confirmed_sent_auto",
  "confirmed_sent_operator",
  "operator_retry_authorized",
  "operator_skipped",
  "operator_stopped",
] as const;

export const SEND_ATTEMPT_RESULTS = ["accepted", "rejected_not_sent", "ambiguous"] as const;

export const MESSAGE_EVENT_TYPES = [
  "sent",
  "send_failed",
  "delivered",
  "soft_bounce",
  "hard_bounce",
  "blocked",
  "replied",
  "auto_replied",
  "unsubscribed",
  "complaint",
] as const;
export type MessageEventType = (typeof MESSAGE_EVENT_TYPES)[number];
export const EVENT_SOURCES = ["provider_api", "mailbox_sync", "webhook", "user", "system"] as const;

export const THREAD_CLASSIFICATIONS = [
  "UNREVIEWED",
  "INTERESTED",
  "NOT_INTERESTED",
  "FOLLOW_UP",
  "OUT_OF_OFFICE",
  "UNSUBSCRIBE",
  "OTHER",
] as const;
export type ThreadClassification = (typeof THREAD_CLASSIFICATIONS)[number];

export const REPLY_KINDS = [
  "human_reply",
  "auto_reply",
  "bounce_report",
  "unsubscribe_request",
  "other",
] as const;
export const MATCH_METHODS = [
  "in_reply_to",
  "references",
  "provider_thread",
  "sender_fallback",
  "none",
] as const;

export const SUPPRESSION_SCOPES = ["workspace", "global"] as const;
export const SUPPRESSION_VALUE_TYPES = ["email", "domain"] as const;
export const SUPPRESSION_REASONS = [
  "UNSUBSCRIBE",
  "HARD_BOUNCE",
  "MANUAL_DO_NOT_CONTACT",
  "COMPLIANCE",
  "COMPLAINT",
] as const;
export const SUPPRESSION_SOURCES = [
  "unsubscribe_link",
  "reply",
  "bounce",
  "manual",
  "import",
  "system",
] as const;
export const UNSUBSCRIBE_METHODS = ["one_click_post", "link_confirm", "reply", "manual"] as const;

export const JURISDICTION_SCOPES = ["global", "workspace"] as const;
export const OUTREACH_POLICY_STATUSES = ["allowed", "review", "blocked"] as const;
export type OutreachPolicyStatus = (typeof OUTREACH_POLICY_STATUSES)[number];

export const WEBHOOK_EVENT_STATUSES = [
  "received",
  "processing",
  "processed",
  "failed",
  "ignored",
] as const;
export const AUDIT_ACTOR_TYPES = ["user", "system", "worker"] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];
