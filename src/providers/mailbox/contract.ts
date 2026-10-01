/**
 * Mailbox provider contract (architecture §14.2, §14.7, §12.1).
 *
 * Campaign/domain code depends ONLY on these types — never on a vendor (Mission Inbox,
 * Infraforge, Google, …). Vendor specifics live in isolated adapter modules under
 * src/providers/mailbox/<adapter>/ (first real adapter: generic SMTP/IMAP, Phase 4).
 */

/** Opaque, adapter-specific connection details resolved server-side (credentials decrypted). */
export type MailboxConnection = {
  mailboxId: string;
  emailAddress: string;
  /** Adapter-private configuration. Never logged; never sent to the browser. */
  config: Readonly<Record<string, unknown>>;
};

export type OutboundMessage = {
  from: { email: string; name?: string };
  to: string;
  replyTo?: string;
  subject: string;
  textBody: string;
  /** Deterministic identity headers reused on every attempt (§12.1). */
  messageId: string; // RFC 5322 Message-ID, e.g. "<uuid@outreach.example>"
  lvMessageId: string; // X-LV-Message-Id value
  inReplyTo?: string;
  references?: string[];
  listUnsubscribe?: { url: string; mailto?: string; oneClick: boolean };
};

export const PROVIDER_ERROR_CODES = [
  "AUTH_FAILED",
  "AUTH_EXPIRED",
  "RATE_LIMITED",
  "QUOTA_EXCEEDED",
  "RECIPIENT_REJECTED",
  "MESSAGE_REJECTED",
  "POLICY_BLOCKED",
  "CONNECTION_FAILED",
  "TIMEOUT",
  "PROVIDER_UNAVAILABLE",
  "NOT_SUPPORTED",
  "UNKNOWN",
] as const;
export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

/**
 * Normalized, user-safe provider error. `safeMessage` must never contain credentials, raw
 * provider bodies or infrastructure details.
 */
export type ProviderError = {
  code: ProviderErrorCode;
  retryable: boolean;
  safeMessage: string;
  providerStatus?: number;
};

/**
 * Send outcome classification (§12.1):
 *  - accepted:          provider confirmed acceptance (has a message id).
 *  - rejected_not_sent: definite rejection BEFORE/WITHOUT acceptance; safe to retry if retryable.
 *  - ambiguous:         may or may not have been sent; NEVER retried automatically —
 *                       the message moves to RECONCILIATION_REQUIRED.
 */
export type SendResult =
  | {
      outcome: "accepted";
      providerMessageId: string;
      providerThreadId?: string;
      acceptedAt: Date;
    }
  | { outcome: "rejected_not_sent"; error: ProviderError }
  | { outcome: "ambiguous"; error: ProviderError };

/** Positive evidence only. "found: false" means "no evidence yet", never "proven not sent". */
export type SentEvidence =
  | {
      found: true;
      source: "sent_history" | "provider_status" | "journal_copy" | "downstream";
      providerMessageId?: string;
      observedAt: Date;
    }
  | { found: false; checkedSources: string[] };

export type InboundMessage = {
  providerMessageId: string;
  receivedAt: Date;
  from: string;
  to: string[];
  subject: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  /** Raw selected headers (e.g. Auto-Submitted, Content-Type) for classification. */
  headers: Readonly<Record<string, string>>;
  textBody: string | null;
};

export type InboundBatch = { items: InboundMessage[]; nextCursor: string };

export type HealthCheck = { name: string; ok: boolean; detail?: string };
export type MailboxHealth = {
  status: "healthy" | "degraded" | "unavailable";
  checkedAt: Date;
  checks: HealthCheck[];
};

export type ConnectionCheck =
  | { ok: true; checkedAt: Date }
  | { ok: false; checkedAt: Date; error: ProviderError };

/** What an adapter can offer the reconciliation and ingestion layers. */
export type ProviderCapabilities = {
  /** Can search the provider's sent history for our identity headers (E1). */
  sentHistoryLookup: boolean;
  /** Provider exposes a message-status lookup by Message-ID (E2'). */
  messageStatusLookup: boolean;
  /** Provider pushes delivery/bounce events via webhooks. */
  webhooks: boolean;
  /** Whether a client-supplied Message-ID is known to be preserved (verified in Phase 0). */
  preservesMessageId: boolean | "unverified";
};

export interface MailboxProvider {
  readonly kind: string;
  readonly capabilities: ProviderCapabilities;

  verifyConnection(conn: MailboxConnection): Promise<ConnectionCheck>;

  /** Opaque checkpoint captured just before a send (e.g. history id); null if unsupported. */
  getSendCheckpoint(conn: MailboxConnection): Promise<string | null>;

  sendMessage(conn: MailboxConnection, message: OutboundMessage): Promise<SendResult>;

  /** Looks for positive evidence that a message was sent (§12.1 E1/E2/E3). */
  getMessageStatus(
    conn: MailboxConnection,
    ids: { messageId: string; lvMessageId: string },
    checkpoint: string | null,
  ): Promise<SentEvidence>;

  /** Incremental inbound sync from an opaque cursor (null = initial bounded sync). */
  listInboundMessages(conn: MailboxConnection, cursor: string | null): Promise<InboundBatch>;

  getMailboxHealth(conn: MailboxConnection): Promise<MailboxHealth>;
}
