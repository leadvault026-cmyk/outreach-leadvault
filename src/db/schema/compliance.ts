import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  foreignKey,
  index,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  JURISDICTION_SCOPES,
  OUTREACH_POLICY_STATUSES,
  SUPPRESSION_REASONS,
  SUPPRESSION_SCOPES,
  SUPPRESSION_SOURCES,
  SUPPRESSION_VALUE_TYPES,
  UNSUBSCRIBE_METHODS,
} from "@/domain/enums";
import { appSchema, id, inList, timestamps, timestamptz } from "./_shared";
import { workspaces } from "./tenancy";

/**
 * Architecture §4.11 / §18. Durable: never hard-deleted ("remove" = lift). Keyed on the
 * address (no FK to prospects) so it survives deletion and re-import.
 * scope='global' ⇔ workspace_id IS NULL.
 */
export const suppressions = appSchema.table(
  "suppressions",
  {
    id: id(),
    scope: text("scope", { enum: SUPPRESSION_SCOPES }).notNull(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id),
    valueType: text("value_type", { enum: SUPPRESSION_VALUE_TYPES }).notNull(),
    valueNormalized: text("value_normalized").notNull(),
    reason: text("reason", { enum: SUPPRESSION_REASONS }).notNull(),
    source: text("source", { enum: SUPPRESSION_SOURCES }).notNull(),
    sourceMessageId: uuid("source_message_id"),
    sourceCampaignId: uuid("source_campaign_id"),
    note: text("note"),
    createdBy: uuid("created_by"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    liftedAt: timestamptz("lifted_at"),
    liftedBy: uuid("lifted_by"),
    liftReason: text("lift_reason"),
  },
  (t) => [
    check("suppressions_scope_check", inList(t.scope, SUPPRESSION_SCOPES)),
    check("suppressions_scope_workspace_check", sql`(${t.scope} = 'global') = (${t.workspaceId} is null)`),
    check("suppressions_value_type_check", inList(t.valueType, SUPPRESSION_VALUE_TYPES)),
    check("suppressions_reason_check", inList(t.reason, SUPPRESSION_REASONS)),
    check("suppressions_source_check", inList(t.source, SUPPRESSION_SOURCES)),
    check(
      "suppressions_value_normalized_check",
      sql`${t.valueNormalized} = lower(btrim(${t.valueNormalized})) and length(${t.valueNormalized}) > 0`,
    ),
    check(
      "suppressions_lift_check",
      sql`(${t.liftedAt} is null and ${t.liftedBy} is null and ${t.liftReason} is null) or (${t.liftedAt} is not null and ${t.liftReason} is not null)`,
    ),
    uniqueIndex("suppressions_ws_active_uq")
      .on(t.workspaceId, t.valueType, t.valueNormalized)
      .where(sql`${t.liftedAt} is null and ${t.scope} = 'workspace'`),
    uniqueIndex("suppressions_global_active_uq")
      .on(t.valueType, t.valueNormalized)
      .where(sql`${t.liftedAt} is null and ${t.scope} = 'global'`),
    index("suppressions_active_value_idx")
      .on(t.valueNormalized)
      .where(sql`${t.liftedAt} is null`),
    index("suppressions_ws_created_idx").on(t.workspaceId, t.createdAt.desc()),
  ],
);

/** Unsubscribe event record; the suppression row is the enforcement. */
export const unsubscribes = appSchema.table(
  "unsubscribes",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    emailNormalized: text("email_normalized").notNull(),
    messageId: uuid("message_id"),
    campaignId: uuid("campaign_id"),
    campaignRecipientId: uuid("campaign_recipient_id"),
    method: text("method", { enum: UNSUBSCRIBE_METHODS }).notNull(),
    suppressionId: uuid("suppression_id")
      .notNull()
      .references(() => suppressions.id),
    userAgent: text("user_agent"),
    ipHash: text("ip_hash"),
    occurredAt: timestamptz("occurred_at").notNull().defaultNow(),
  },
  (t) => [
    unique("unsubscribes_message_method_key").on(t.messageId, t.method),
    index("unsubscribes_ws_occurred_idx").on(t.workspaceId, t.occurredAt.desc()),
    check("unsubscribes_method_check", inList(t.method, UNSUBSCRIBE_METHODS)),
  ],
);

/**
 * Architecture §4.3 / §10. Data-driven compliance by geography. A country/region with no row
 * resolves to 'review' (fail closed). The application ships with NO country marked 'allowed'.
 */
export const jurisdictionPolicies = appSchema.table(
  "jurisdiction_policies",
  {
    id: id(),
    scope: text("scope", { enum: JURISDICTION_SCOPES }).notNull(),
    workspaceId: uuid("workspace_id"),
    countryCode: char("country_code", { length: 2 }).notNull(),
    regionCode: text("region_code"),
    outreachStatus: text("outreach_status", { enum: OUTREACH_POLICY_STATUSES }).notNull(),
    requiresPostalAddress: boolean("requires_postal_address").notNull().default(true),
    requiresUnsubscribeLink: boolean("requires_unsubscribe_link").notNull().default(true),
    footerTemplate: text("footer_template"),
    notes: text("notes"),
    updatedBy: uuid("updated_by"),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "jurisdiction_policies_workspace_fk",
      columns: [t.workspaceId],
      foreignColumns: [workspaces.id],
    }),
    check("jurisdiction_policies_scope_check", inList(t.scope, JURISDICTION_SCOPES)),
    check(
      "jurisdiction_policies_scope_workspace_check",
      sql`(${t.scope} = 'global') = (${t.workspaceId} is null)`,
    ),
    check("jurisdiction_policies_status_check", inList(t.outreachStatus, OUTREACH_POLICY_STATUSES)),
    check("jurisdiction_policies_country_format", sql`${t.countryCode} ~ '^[A-Z]{2}$'`),
    check(
      "jurisdiction_policies_region_format",
      sql`${t.regionCode} is null or ${t.regionCode} ~ '^[A-Z]{2}-[A-Z0-9]{1,3}$'`,
    ),
    uniqueIndex("jurisdiction_policies_scope_uq").on(
      sql`coalesce(${t.workspaceId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      t.countryCode,
      sql`coalesce(${t.regionCode}, '')`,
    ),
  ],
);
