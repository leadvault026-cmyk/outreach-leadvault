/**
 * Audit-log foundation (architecture §30). Pure helpers; the writer lives in src/server/audit.ts.
 */

/** Known audit actions. Format enforced by a DB CHECK: dot-separated lowercase segments. */
export const AUDIT_ACTIONS = {
  signedIn: "auth.signed_in",
  signedOut: "auth.signed_out",
  passwordChanged: "auth.password_changed",
  workspaceAccessDenied: "workspace.access_denied",
  importCreated: "import.created",
  importCompleted: "import.completed",
  importFailed: "import.failed",
  importCancelled: "import.cancelled",
  suppressionCreated: "suppression.created",
  suppressionLifted: "suppression.lifted",
  audienceCreated: "audience.created",
  audienceUpdated: "audience.updated",
  audienceMembersAdded: "audience.members_added",
  audienceMembersRemoved: "audience.members_removed",
} as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

const SENSITIVE_KEY =
  /pass(word)?|secret|token|api[-_]?key|credential|authori[sz]ation|cookie|session|private|signature|body|html|content/i;
const MAX_STRING = 500;
const MAX_KEYS = 30;
const MAX_ARRAY = 20;

type Primitive = string | number | boolean | null;
export type SafeMetadata = Record<string, Primitive | Primitive[]>;

function safeValue(value: unknown): Primitive | Primitive[] | undefined {
  if (value === null) return null;
  if (typeof value === "string") {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY)
      .map((v) => safeValue(v))
      .filter((v): v is Primitive => v !== undefined && !Array.isArray(v));
  }
  return undefined; // nested objects, functions, etc. are dropped
}

/**
 * Reduce arbitrary metadata to a small, flat, non-sensitive record. Keys that look like they
 * could hold credentials or message content are dropped entirely — never logged.
 */
export function sanitizeAuditMetadata(input: Record<string, unknown> | undefined): SafeMetadata {
  const out: SafeMetadata = {};
  if (!input) return out;
  for (const [key, raw] of Object.entries(input).slice(0, MAX_KEYS)) {
    if (SENSITIVE_KEY.test(key)) continue;
    const value = safeValue(raw);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "auth.signed_in": "Signed in",
  "auth.signed_out": "Signed out",
  "auth.password_changed": "Changed password",
  "workspace.access_denied": "Workspace access denied",
  "import.created": "Import uploaded",
  "import.completed": "Import completed",
  "import.failed": "Import failed",
  "import.cancelled": "Import cancelled",
  "suppression.created": "Suppression added",
  "suppression.lifted": "Suppression lifted",
  "audience.created": "Audience created",
  "audience.updated": "Audience updated",
  "audience.members_added": "Audience members added",
  "audience.members_removed": "Audience members removed",
};
