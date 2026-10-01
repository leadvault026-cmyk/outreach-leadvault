import {
  BarChart3,
  FileText,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Mail,
  Megaphone,
  Settings,
  ShieldBan,
  Upload,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * Single source for application navigation: sidebar, mobile drawer, top bar titles, navigation
 * search and the route-existence test all read from here.
 */
export type NavItem = {
  key: string;
  label: string;
  /** Path segment under /w/[workspaceSlug]/ */
  segment: string;
  icon: LucideIcon;
  description: string;
};

export type NavSection = { label: string | null; items: NavItem[] };

export const NAV_SECTIONS: NavSection[] = [
  {
    label: null,
    items: [
      {
        key: "dashboard",
        label: "Dashboard",
        segment: "dashboard",
        icon: LayoutDashboard,
        description: "Operational overview of campaigns, sending and replies.",
      },
    ],
  },
  {
    label: "Prospecting",
    items: [
      {
        key: "prospects",
        label: "Prospects",
        segment: "prospects",
        icon: Users,
        description: "Approved research records and their outreach eligibility.",
      },
      {
        key: "audiences",
        label: "Audiences",
        segment: "audiences",
        icon: ListChecks,
        description: "Reusable prospect groups for campaigns.",
      },
      {
        key: "imports",
        label: "Imports",
        segment: "imports",
        icon: Upload,
        description: "CSV imports of approved prospect intelligence.",
      },
    ],
  },
  {
    label: "Outreach",
    items: [
      {
        key: "campaigns",
        label: "Campaigns",
        segment: "campaigns",
        icon: Megaphone,
        description: "Sequenced, scheduled outreach to eligible prospects.",
      },
      {
        key: "inbox",
        label: "Inbox",
        segment: "inbox",
        icon: Inbox,
        description: "Replies matched to prospects, campaigns and threads.",
      },
      {
        key: "templates",
        label: "Templates",
        segment: "templates",
        icon: FileText,
        description: "Reusable email content for sequence steps.",
      },
    ],
  },
  {
    label: "Infrastructure",
    items: [
      {
        key: "mailboxes",
        label: "Mailboxes",
        segment: "mailboxes",
        icon: Mail,
        description: "Sending mailboxes, limits, warm-up and health.",
      },
      {
        key: "suppression",
        label: "Suppression",
        segment: "suppression",
        icon: ShieldBan,
        description: "Durable do-not-contact list across campaigns.",
      },
    ],
  },
  {
    label: "Insights",
    items: [
      {
        key: "analytics",
        label: "Analytics",
        segment: "analytics",
        icon: BarChart3,
        description: "Campaign, step, mailbox and date-range performance.",
      },
    ],
  },
];

export const SETTINGS_NAV_ITEM: NavItem = {
  key: "settings",
  label: "Settings",
  segment: "settings",
  icon: Settings,
  description: "Workspace, team, compliance and audit settings.",
};

export const ALL_NAV_ITEMS: NavItem[] = [
  ...NAV_SECTIONS.flatMap((s) => s.items),
  SETTINGS_NAV_ITEM,
];

export function workspaceHref(workspaceSlug: string, segment: string): string {
  return `/w/${workspaceSlug}/${segment}`;
}

/** Best nav match for a pathname like /w/acme/settings/team. */
export function activeNavKey(pathname: string): string | null {
  const segment = pathname.split("/")[3] ?? null;
  if (segment === "profile") return "profile";
  return ALL_NAV_ITEMS.find((i) => i.segment === segment)?.key ?? null;
}

export function navItemByKey(key: string): NavItem | undefined {
  return ALL_NAV_ITEMS.find((i) => i.key === key);
}
