import { sql } from "drizzle-orm";
import { boolean, char, check, index, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { MEMBER_STATUSES, WORKSPACE_KINDS, WORKSPACE_ROLES } from "@/domain/enums";
import { appSchema, authUsers, id, inList, timestamps, timestamptz } from "./_shared";

/** Architecture §4.2 — a workspace is the tenant boundary (one client = one workspace). */
export const workspaces = appSchema.table(
  "workspaces",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    kind: text("kind", { enum: WORKSPACE_KINDS }).notNull().default("client"),
    defaultTimezone: text("default_timezone").notNull(),
    senderCountryCode: char("sender_country_code", { length: 2 }),
    compliancePostalAddress: text("compliance_postal_address"),
    isDemo: boolean("is_demo").notNull().default(false),
    archivedAt: timestamptz("archived_at"),
    createdBy: uuid("created_by"),
    ...timestamps,
  },
  (t) => [
    check("workspaces_slug_format", sql`${t.slug} ~ '^[a-z0-9-]{2,48}$'`),
    check("workspaces_kind_check", inList(t.kind, WORKSPACE_KINDS)),
    check(
      "workspaces_sender_country_format",
      sql`${t.senderCountryCode} is null or ${t.senderCountryCode} ~ '^[A-Z]{2}$'`,
    ),
  ],
);

/** App-level user data; identity itself lives in Supabase auth.users. */
export const profiles = appSchema.table("profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  fullName: text("full_name"),
  /** Mirror of auth.users.email, maintained by trigger (auth schema is not readable under RLS). */
  email: text("email"),
  /** May create workspaces; grants no workspace data access by itself (architecture §6). */
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
  ...timestamps,
});

export const workspaceMembers = appSchema.table(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    role: text("role", { enum: WORKSPACE_ROLES }).notNull(),
    status: text("status", { enum: MEMBER_STATUSES }).notNull().default("active"),
    invitedBy: uuid("invited_by"),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    index("workspace_members_user_idx").on(t.userId),
    check("workspace_members_role_check", inList(t.role, WORKSPACE_ROLES)),
    check("workspace_members_status_check", inList(t.status, MEMBER_STATUSES)),
  ],
);
