import type { Capability } from "@/domain/permissions";

export type SettingsSection = {
  key: string;
  label: string;
  description: string;
  status: "available" | "planned";
  capability: Capability;
  plannedDetail?: string;
};

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    key: "workspace",
    label: "Workspace",
    description: "Name, time zone, sender country and compliance postal address.",
    status: "available",
    capability: "workspace.view",
  },
  {
    key: "team",
    label: "Team",
    description: "Members of this workspace and their roles.",
    status: "available",
    capability: "workspace.view",
  },
  {
    key: "compliance",
    label: "Compliance",
    description: "Jurisdiction policies that decide where outreach may be sent.",
    status: "available",
    capability: "workspace.view",
  },
  {
    key: "audit-log",
    label: "Audit log",
    description: "Who did what, and when, in this workspace.",
    status: "available",
    capability: "audit.view",
  },
  {
    key: "sending",
    label: "Sending",
    description: "Default sending windows, limits and warm-up ramps.",
    status: "planned",
    capability: "mailboxes.manage",
    plannedDetail: "Configured with mailboxes and the scheduling engine (Phases 4–5).",
  },
  {
    key: "integrations",
    label: "Integrations",
    description: "Mailbox infrastructure and system status.",
    status: "planned",
    capability: "mailboxes.manage",
    plannedDetail: "Provider connections arrive with the first mailbox adapter (Phase 4).",
  },
  {
    key: "notifications",
    label: "Notifications",
    description: "Operator alerts for mailbox health, review queues and failures.",
    status: "planned",
    capability: "workspace.view",
    plannedDetail: "Alerting arrives with monitoring hardening (Phase 8).",
  },
  {
    key: "security",
    label: "Security",
    description: "Two-factor authentication and session policies.",
    status: "planned",
    capability: "workspace.view",
    plannedDetail: "MFA enforcement for Owners and Admins is planned for Phase 8 (owner decision §30-7).",
  },
];
