/**
 * Copy for modules whose functionality arrives in later phases (Prospects, Audiences, Imports and
 * Suppression became real modules in Phase 2). Each page explains what the
 * module does and what the operator will be able to do — no dead ends, no "coming soon".
 */
export type ModuleKey = "campaigns" | "inbox" | "templates" | "mailboxes" | "analytics";

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
    summary:
      "One place for replies, matched to the prospect, campaign, recipient and original message.",
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
