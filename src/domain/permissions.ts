import { WORKSPACE_ROLES, type WorkspaceRole } from "./enums";

/**
 * Central authorization rules (architecture §7 role matrix). Pure and dependency-free, so the
 * server layer enforces them and UI components can use them to decide what to render.
 * UI hiding is never the security boundary — the server checks `can()` and RLS checks again.
 */
const RANK: Record<WorkspaceRole, number> = { OWNER: 4, ADMIN: 3, OPERATOR: 2, VIEWER: 1 };

export const CAPABILITIES = {
  "workspace.view": "VIEWER",
  "prospects.manage": "OPERATOR",
  "audiences.manage": "OPERATOR",
  "templates.manage": "OPERATOR",
  "campaigns.manage": "OPERATOR",
  "inbox.classify": "OPERATOR",
  "suppression.add": "OPERATOR",
  "suppression.lift": "ADMIN",
  "customFields.manage": "ADMIN",
  "mailboxes.manage": "ADMIN",
  "compliance.manage": "ADMIN",
  "team.manage": "ADMIN",
  "audit.view": "ADMIN",
  "workspace.settings": "OWNER",
} as const satisfies Record<string, WorkspaceRole>;

export type Capability = keyof typeof CAPABILITIES;

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return typeof value === "string" && (WORKSPACE_ROLES as readonly string[]).includes(value);
}

export function hasRoleAtLeast(role: WorkspaceRole, minimum: WorkspaceRole): boolean {
  return RANK[role] >= RANK[minimum];
}

export function can(role: WorkspaceRole | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  return hasRoleAtLeast(role, CAPABILITIES[capability]);
}

/**
 * LeadVault-wide (global) suppression is not a workspace role: only platform administrators may
 * create or lift it, and the database refuses global writes from user sessions entirely.
 */
export function canManageGlobalSuppression(profile: { isPlatformAdmin: boolean } | null): boolean {
  return Boolean(profile?.isPlatformAdmin);
}

/** Team management: ADMINs manage members but may not grant, change or remove OWNER. */
export function canManageMember(
  actorRole: WorkspaceRole,
  targetCurrentRole: WorkspaceRole,
  targetNewRole?: WorkspaceRole,
): boolean {
  if (actorRole === "OWNER") return true;
  if (actorRole !== "ADMIN") return false;
  return targetCurrentRole !== "OWNER" && targetNewRole !== "OWNER";
}

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  OPERATOR: "Operator",
  VIEWER: "Viewer",
};

export const ROLE_DESCRIPTIONS: Record<WorkspaceRole, string> = {
  OWNER: "Full control, including workspace settings and ownership.",
  ADMIN: "Manages team, mailboxes, compliance settings and suppression lifts.",
  OPERATOR: "Runs day-to-day outreach: prospects, audiences, campaigns and the inbox.",
  VIEWER: "Read-only access to the workspace.",
};
