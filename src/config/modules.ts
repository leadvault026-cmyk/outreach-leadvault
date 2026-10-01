/**
 * Copy for modules whose functionality arrives in later phases. Each page explains what the
 * module does and what the operator will be able to do — no dead ends, no "coming soon".
 */
export type ModuleKey =
  | "prospects"
  | "audiences"
  | "imports"
  | "campaigns"
  | "inbox"
  | "templates"
  | "mailboxes"
  | "suppression"
  | "analytics";

export type ModuleInfo = {
  title: string;
  summary: string;
  emptyTitle: string;
  emptyDescription: string;
  primaryAction: string;
  capabilities: string[];
  phase: string;
  safeguards?: string[];
};

export const MODULES: Record<ModuleKey, ModuleInfo> = {
  prospects: {
    title: "Prospects",
    summary:
      "Approved prospect intelligence from LeadVault research, with each record's campaign eligibility and the reasons behind it.",
    emptyTitle: "No prospects imported yet",
    emptyDescription:
      "Prospects arrive through CSV imports of approved research. Each record keeps its research data separate from its outreach state.",
    primaryAction: "Import prospects",
    capabilities: [
      "Search, filter and sort by company, contact, title, location and business type",
      "Eligibility status with plain-language reasons (eligible, needs review, ineligible, suppressed)",
      "Email verification status carried over from LeadVault research",
      "Prospect detail with outreach history across campaigns",
      "Bulk selection to add prospects to audiences or campaigns",
    ],
    phase: "Phase 2",
    safeguards: [
      "Research data is never changed by campaign activity.",
      "Suppressed addresses can never be enrolled, whatever audience they belong to.",
    ],
  },
  audiences: {
    title: "Audiences",
    summary: "Reusable groups of prospects, such as “Texas medical providers”, used to start campaigns.",
    emptyTitle: "No audiences created",
    emptyDescription:
      "Audiences group prospects for campaign targeting. Membership never overrides suppression or eligibility.",
    primaryAction: "Create audience",
    capabilities: [
      "Build audiences from imports, filters or hand-picked prospects",
      "See total, eligible, suppressed and needs-review counts before a campaign",
      "Add and remove members, with full campaign history per audience",
    ],
    phase: "Phase 2",
  },
  imports: {
    title: "Imports",
    summary:
      "Controlled CSV import of approved prospect intelligence: upload, map columns, validate, preview, import and review the summary.",
    emptyTitle: "No imports yet",
    emptyDescription:
      "Every import produces a row-by-row record: created, updated, skipped, invalid, suppressed or duplicate. No row is ever silently discarded.",
    primaryAction: "Start an import",
    capabilities: [
      "Column mapping for files that differ from the standard delivery layout",
      "Duplicate detection within the file and against existing prospects",
      "Preview before anything is written",
      "Import summary with downloadable issues",
    ],
    phase: "Phase 2",
    safeguards: ["A previously suppressed address is never reactivated by a re-import."],
  },
  campaigns: {
    title: "Campaigns",
    summary:
      "Guided campaign builder: details, audience, sending identity, sequence, schedule and limits, review, then launch.",
    emptyTitle: "No campaigns created",
    emptyDescription:
      "Campaigns send person-to-person email sequences to eligible prospects within sending windows and daily limits.",
    primaryAction: "New campaign",
    capabilities: [
      "Seven-step builder with validation before launch",
      "Initial email plus follow-ups with delays and personalization",
      "Pause, resume and cancel with immediate effect on scheduled sends",
      "Per-recipient status from scheduled through completed",
    ],
    phase: "Phase 3",
    safeguards: [
      "Sequences stop automatically on reply, hard bounce, unsubscribe or suppression.",
      "An ambiguous send is never retried automatically.",
    ],
  },
  inbox: {
    title: "Inbox",
    summary: "One place for replies, matched to the prospect, campaign, recipient and original message.",
    emptyTitle: "No replies yet",
    emptyDescription:
      "Replies appear here once mailboxes are connected and campaigns are sending. A reply automatically stops that prospect's remaining sequence.",
    primaryAction: "Review replies",
    capabilities: [
      "Classify replies: interested, not interested, follow up, out of office, unsubscribe",
      "Thread view built from Message-ID, In-Reply-To and References headers",
      "Filters by classification, campaign and mailbox",
    ],
    phase: "Phase 6",
  },
  templates: {
    title: "Templates",
    summary: "Reusable plain-text email content with validated personalization variables.",
    emptyTitle: "No templates created",
    emptyDescription:
      "Templates populate campaign sequence steps. Campaigns keep their own copy, so editing a template never changes a running campaign.",
    primaryAction: "New template",
    capabilities: [
      "Variables such as {{first_name}}, {{company_name}}, {{city}} with validation",
      "Preview as a specific prospect",
      "Plain person-to-person email as the default format",
    ],
    phase: "Phase 3",
  },
  mailboxes: {
    title: "Mailboxes",
    summary:
      "LeadVault-controlled sending mailboxes on dedicated outreach domains, with limits, sending windows, warm-up and health.",
    emptyTitle: "No mailboxes connected",
    emptyDescription:
      "Mailboxes connect through the provider adapter layer. No mailbox provider is connected in this environment, and no email can be sent.",
    primaryAction: "Connect mailbox",
    capabilities: [
      "Connection status, daily limits, sending windows and time zones",
      "Warm-up ramp enforced by the scheduler",
      "Automatic pause when bounce or block rates exceed safe thresholds",
    ],
    phase: "Phase 4",
  },
  suppression: {
    title: "Suppression",
    summary:
      "The durable do-not-contact list: unsubscribes, hard bounces, manual entries and compliance holds, for this workspace and LeadVault-wide.",
    emptyTitle: "No suppression records",
    emptyDescription:
      "Suppressed addresses and domains are checked again before every single send. Records are never deleted, only lifted with a reason.",
    primaryAction: "Add suppression",
    capabilities: [
      "Workspace and global (LeadVault-wide) suppression scopes",
      "Email or whole-domain entries with reason and source",
      "Lift with reason and audit trail (Admins only)",
    ],
    phase: "Phase 2 (list) · Phase 6 (automatic enforcement)",
  },
  analytics: {
    title: "Analytics",
    summary: "Reply-led performance by campaign, sequence step, mailbox and date range.",
    emptyTitle: "No analytics yet",
    emptyDescription:
      "Analytics appear once campaigns have sent. Reply rate, positive reply rate, bounce rate and unsubscribe rate are the primary measures — not open rate.",
    primaryAction: "View report",
    capabilities: [
      "Sent, bounced, replies, positive and negative replies, unsubscribes",
      "Breakdowns by campaign, step, mailbox and date range",
    ],
    phase: "Phase 7",
  },
};
