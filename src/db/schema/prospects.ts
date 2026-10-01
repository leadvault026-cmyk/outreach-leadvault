import { sql } from "drizzle-orm";
import {
  char,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  CUSTOM_FIELD_TYPES,
  ELIGIBILITY_STATUSES,
  EMAIL_VERIFICATION_STATUSES,
  IMPORT_ROW_OUTCOMES,
  IMPORT_STATUSES,
} from "@/domain/enums";
import { appSchema, id, inList, timestamps, timestamptz } from "./_shared";
import { workspaces } from "./tenancy";

/**
 * RESEARCH TRUTH (architecture §4.3). Written only by imports and explicit, audited research
 * corrections — never by the outreach engine.
 */
export const prospects = appSchema.table(
  "prospects",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    companyName: text("company_name").notNull(),
    website: text("website"),
    websiteDomain: text("website_domain"),
    contactName: text("contact_name"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    contactTitle: text("contact_title"),
    email: text("email"),
    emailNormalized: text("email_normalized"),
    emailDomain: text("email_domain"),
    /** Normalized verification (§14.7.5). STALE is also derived from age by the domain layer. */
    emailVerificationStatus: text("email_verification_status", {
      enum: EMAIL_VERIFICATION_STATUSES,
    })
      .notNull()
      .default("UNKNOWN"),
    emailVerifiedAt: timestamptz("email_verified_at"),
    /** e.g. "research_import", "provider:<name>", "manual". */
    emailVerificationSource: text("email_verification_source"),
    /** Raw label from the source (e.g. "catch-all"), kept for traceability. */
    emailVerificationDetail: text("email_verification_detail"),
    phone: text("phone"),
    addressLine: text("address_line"),
    city: text("city"),
    state: text("state"),
    postalCode: text("postal_code"),
    /** ISO 3166-1 alpha-2. No default: unknown country resolves to REVIEW (§10). */
    countryCode: char("country_code", { length: 2 }),
    /** ISO 3166-2 subdivision when derivable (e.g. US-TX). */
    regionCode: text("region_code"),
    businessType: text("business_type"),
    qualificationBasis: text("qualification_basis"),
    evidenceUrl: text("evidence_url"),
    customFields: jsonb("custom_fields").$type<Record<string, string | number | null>>().notNull().default({}),
    researchSourceRef: text("research_source_ref"),
    researchApprovedAt: timestamptz("research_approved_at"),
    firstImportId: uuid("first_import_id"),
    lastImportId: uuid("last_import_id"),
    archivedAt: timestamptz("archived_at"),
    ...timestamps,
  },
  (t) => [
    unique("prospects_workspace_id_id_key").on(t.workspaceId, t.id),
    uniqueIndex("prospects_ws_email_uq")
      .on(t.workspaceId, t.emailNormalized)
      .where(sql`${t.emailNormalized} is not null`),
    uniqueIndex("prospects_ws_research_ref_uq")
      .on(t.workspaceId, t.researchSourceRef)
      .where(sql`${t.researchSourceRef} is not null`),
    index("prospects_ws_country_idx").on(t.workspaceId, t.countryCode, t.regionCode),
    index("prospects_ws_state_idx").on(t.workspaceId, t.state),
    index("prospects_ws_business_type_idx").on(t.workspaceId, t.businessType),
    index("prospects_ws_domain_idx").on(t.workspaceId, t.websiteDomain),
    index("prospects_ws_created_idx").on(t.workspaceId, t.createdAt.desc()),
    check(
      "prospects_email_normalized_check",
      sql`${t.emailNormalized} is null or ${t.emailNormalized} = lower(btrim(${t.emailNormalized}))`,
    ),
    check("prospects_country_format", sql`${t.countryCode} is null or ${t.countryCode} ~ '^[A-Z]{2}$'`),
    check(
      "prospects_verification_status_check",
      inList(t.emailVerificationStatus, EMAIL_VERIFICATION_STATUSES),
    ),
    check(
      "prospects_verification_provenance_check",
      sql`${t.emailVerificationStatus} = 'UNKNOWN' or (${t.emailVerifiedAt} is not null and ${t.emailVerificationSource} is not null)`,
    ),
    foreignKey({
      name: "prospects_first_import_fk",
      columns: [t.workspaceId, t.firstImportId],
      foreignColumns: [prospectImports.workspaceId, prospectImports.id],
    }),
    foreignKey({
      name: "prospects_last_import_fk",
      columns: [t.workspaceId, t.lastImportId],
      foreignColumns: [prospectImports.workspaceId, prospectImports.id],
    }),
  ],
);

/** OUTREACH STATE (1:1 with prospects) — written by the engine, never by imports. */
export const prospectOutreachState = appSchema.table(
  "prospect_outreach_state",
  {
    prospectId: uuid("prospect_id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    eligibility: text("eligibility", { enum: ELIGIBILITY_STATUSES }).notNull(),
    eligibilityReasons: text("eligibility_reasons").array().notNull().default(sql`'{}'::text[]`),
    eligibilityCheckedAt: timestamptz("eligibility_checked_at").notNull(),
    reviewDecision: text("review_decision", { enum: ["approved", "rejected"] }),
    reviewDecidedBy: uuid("review_decided_by"),
    reviewDecidedAt: timestamptz("review_decided_at"),
    lastContactedAt: timestamptz("last_contacted_at"),
    lastReplyAt: timestamptz("last_reply_at"),
    lastOutcome: text("last_outcome"),
    activeEnrollmentCount: integer("active_enrollment_count").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "prospect_outreach_state_prospect_fk",
      columns: [t.workspaceId, t.prospectId],
      foreignColumns: [prospects.workspaceId, prospects.id],
    }).onDelete("cascade"),
    index("prospect_outreach_state_ws_eligibility_idx").on(t.workspaceId, t.eligibility),
    check("prospect_outreach_state_eligibility_check", inList(t.eligibility, ELIGIBILITY_STATUSES)),
    check(
      "prospect_outreach_state_review_check",
      sql`${t.reviewDecision} is null or ${t.reviewDecision} in ('approved', 'rejected')`,
    ),
    check("prospect_outreach_state_count_check", sql`${t.activeEnrollmentCount} >= 0`),
  ],
);

export const workspaceCustomFields = appSchema.table(
  "workspace_custom_fields",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    key: text("key").notNull(),
    label: text("label").notNull(),
    dataType: text("data_type", { enum: CUSTOM_FIELD_TYPES }).notNull().default("text"),
    ...timestamps,
  },
  (t) => [
    unique("workspace_custom_fields_ws_key_key").on(t.workspaceId, t.key),
    check("workspace_custom_fields_key_format", sql`${t.key} ~ '^[a-z][a-z0-9_]{1,40}$'`),
    check("workspace_custom_fields_type_check", inList(t.dataType, CUSTOM_FIELD_TYPES)),
  ],
);

/** Architecture §4.4 — every uploaded file and every row is accounted for. */
export const prospectImports = appSchema.table(
  "prospect_imports",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    createdBy: uuid("created_by").notNull(),
    sourceLabel: text("source_label"),
    fileName: text("file_name").notNull(),
    storagePath: text("storage_path").notNull(),
    fileSha256: text("file_sha256").notNull(),
    /** Country applied to rows without one (recorded on the import, §10). */
    defaultCountryCode: char("default_country_code", { length: 2 }),
    rowCount: integer("row_count"),
    status: text("status", { enum: IMPORT_STATUSES }).notNull(),
    columnMapping: jsonb("column_mapping").$type<Record<string, string>>(),
    options: jsonb("options").$type<Record<string, unknown>>(),
    createdCount: integer("created_count").notNull().default(0),
    updatedCount: integer("updated_count").notNull().default(0),
    unchangedCount: integer("unchanged_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    invalidCount: integer("invalid_count").notNull().default(0),
    suppressedCount: integer("suppressed_count").notNull().default(0),
    duplicateCount: integer("duplicate_count").notNull().default(0),
    errorCode: text("error_code"),
    completedAt: timestamptz("completed_at"),
    ...timestamps,
  },
  (t) => [
    unique("prospect_imports_workspace_id_id_key").on(t.workspaceId, t.id),
    index("prospect_imports_ws_created_idx").on(t.workspaceId, t.createdAt.desc()),
    index("prospect_imports_ws_sha_idx").on(t.workspaceId, t.fileSha256),
    check("prospect_imports_status_check", inList(t.status, IMPORT_STATUSES)),
    check(
      "prospect_imports_default_country_format",
      sql`${t.defaultCountryCode} is null or ${t.defaultCountryCode} ~ '^[A-Z]{2}$'`,
    ),
  ],
);

export const prospectImportRows = appSchema.table(
  "prospect_import_rows",
  {
    importId: uuid("import_id").notNull(),
    rowNumber: integer("row_number").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    raw: jsonb("raw").$type<Record<string, string>>().notNull(),
    mapped: jsonb("mapped").$type<Record<string, unknown>>(),
    outcome: text("outcome", { enum: IMPORT_ROW_OUTCOMES }).notNull(),
    issues: jsonb("issues")
      .$type<Array<{ code: string; field?: string; severity: string; message: string }>>()
      .notNull()
      .default([]),
    prospectId: uuid("prospect_id"),
    overriddenBy: uuid("overridden_by"),
  },
  (t) => [
    primaryKey({ columns: [t.importId, t.rowNumber] }),
    foreignKey({
      name: "prospect_import_rows_import_fk",
      columns: [t.workspaceId, t.importId],
      foreignColumns: [prospectImports.workspaceId, prospectImports.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "prospect_import_rows_prospect_fk",
      columns: [t.workspaceId, t.prospectId],
      foreignColumns: [prospects.workspaceId, prospects.id],
    }),
    index("prospect_import_rows_outcome_idx").on(t.importId, t.outcome),
    check("prospect_import_rows_outcome_check", inList(t.outcome, IMPORT_ROW_OUTCOMES)),
    check("prospect_import_rows_row_number_check", sql`${t.rowNumber} >= 1`),
  ],
);
