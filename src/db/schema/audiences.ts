import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  jsonb,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { AUDIENCE_MEMBER_SOURCES } from "@/domain/enums";
import { appSchema, id, inList, timestamps, timestamptz } from "./_shared";
import { prospectImports, prospects } from "./prospects";
import { workspaces } from "./tenancy";

/** Architecture §4.5 — reusable static prospect groups. Membership never overrides suppression. */
export const audiences = appSchema.table(
  "audiences",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    name: text("name").notNull(),
    description: text("description"),
    sourceImportId: uuid("source_import_id"),
    savedFilter: jsonb("saved_filter").$type<Record<string, unknown>>(),
    createdBy: uuid("created_by"),
    archivedAt: timestamptz("archived_at"),
    ...timestamps,
  },
  (t) => [
    unique("audiences_workspace_id_id_key").on(t.workspaceId, t.id),
    uniqueIndex("audiences_ws_name_uq")
      .on(t.workspaceId, sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} is null`),
    foreignKey({
      name: "audiences_source_import_fk",
      columns: [t.workspaceId, t.sourceImportId],
      foreignColumns: [prospectImports.workspaceId, prospectImports.id],
    }),
  ],
);

export const audienceMembers = appSchema.table(
  "audience_members",
  {
    audienceId: uuid("audience_id").notNull(),
    prospectId: uuid("prospect_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    addedVia: text("added_via", { enum: AUDIENCE_MEMBER_SOURCES }).notNull(),
    addedBy: uuid("added_by"),
    addedAt: timestamptz("added_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.audienceId, t.prospectId] }),
    foreignKey({
      name: "audience_members_audience_fk",
      columns: [t.workspaceId, t.audienceId],
      foreignColumns: [audiences.workspaceId, audiences.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "audience_members_prospect_fk",
      columns: [t.workspaceId, t.prospectId],
      foreignColumns: [prospects.workspaceId, prospects.id],
    }).onDelete("restrict"),
    index("audience_members_prospect_idx").on(t.prospectId),
    check("audience_members_added_via_check", inList(t.addedVia, AUDIENCE_MEMBER_SOURCES)),
  ],
);

/** Architecture §4.6 — campaigns snapshot template content; edits never propagate. */
export const templates = appSchema.table(
  "templates",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    name: text("name").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    variablesUsed: text("variables_used").array().notNull().default(sql`'{}'::text[]`),
    createdBy: uuid("created_by"),
    archivedAt: timestamptz("archived_at"),
    ...timestamps,
  },
  (t) => [
    unique("templates_workspace_id_id_key").on(t.workspaceId, t.id),
    uniqueIndex("templates_ws_name_uq")
      .on(t.workspaceId, sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} is null`),
  ],
);
