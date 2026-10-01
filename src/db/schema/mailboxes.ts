import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  date,
  foreignKey,
  integer,
  jsonb,
  primaryKey,
  smallint,
  text,
  time,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  INGESTION_MODES,
  MAILBOX_STATUSES,
  PROVIDER_CONNECTION_STATUSES,
  PROVIDERS,
  WARMUP_STATUSES,
} from "@/domain/enums";
import { appSchema, id, inList, timestamps, timestamptz } from "./_shared";
import { workspaces } from "./tenancy";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/**
 * Architecture §4.7. Holds encrypted credentials (AES-256-GCM, app-level). The
 * `encrypted_credentials` column is NOT granted to the `authenticated` role (see the security
 * migration) — only server-side privileged code can read it.
 */
export const providerConnections = appSchema.table(
  "provider_connections",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    provider: text("provider", { enum: PROVIDERS }).notNull(),
    accountEmail: text("account_email").notNull(),
    externalAccountId: text("external_account_id"),
    status: text("status", { enum: PROVIDER_CONNECTION_STATUSES }).notNull(),
    encryptedCredentials: bytea("encrypted_credentials").notNull(),
    credentialsKeyVersion: smallint("credentials_key_version").notNull(),
    scopes: text("scopes")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    ingestionMode: text("ingestion_mode", { enum: INGESTION_MODES })
      .notNull()
      .default("provider_api"),
    inboundRoutingAddress: text("inbound_routing_address"),
    accessTokenExpiresAt: timestamptz("access_token_expires_at"),
    syncCursor: text("sync_cursor"),
    pushWatchExpiresAt: timestamptz("push_watch_expires_at"),
    lastVerifiedAt: timestamptz("last_verified_at"),
    lastErrorCode: text("last_error_code"),
    lastErrorAt: timestamptz("last_error_at"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdBy: uuid("created_by"),
    ...timestamps,
  },
  (t) => [
    unique("provider_connections_workspace_id_id_key").on(t.workspaceId, t.id),
    unique("provider_connections_ws_provider_email_key").on(
      t.workspaceId,
      t.provider,
      t.accountEmail,
    ),
    check("provider_connections_provider_check", inList(t.provider, PROVIDERS)),
    check("provider_connections_status_check", inList(t.status, PROVIDER_CONNECTION_STATUSES)),
    check("provider_connections_ingestion_check", inList(t.ingestionMode, INGESTION_MODES)),
  ],
);

export type RampStep = { fromDay: number; limit: number };

export const mailboxes = appSchema.table(
  "mailboxes",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    providerConnectionId: uuid("provider_connection_id").notNull(),
    emailAddress: text("email_address").notNull(),
    displayName: text("display_name").notNull(),
    status: text("status", { enum: MAILBOX_STATUSES }).notNull(),
    statusReason: text("status_reason"),
    enabled: boolean("enabled").notNull().default(true),
    dailySendLimit: integer("daily_send_limit").notNull(),
    minSecondsBetweenSends: integer("min_seconds_between_sends").notNull().default(90),
    sendDays: smallint("send_days")
      .array()
      .notNull()
      .default(sql`'{1,2,3,4,5}'::smallint[]`),
    windowStart: time("window_start").notNull().default("08:00"),
    windowEnd: time("window_end").notNull().default("17:00"),
    timezone: text("timezone").notNull(),
    signature: text("signature"),
    nextAvailableAt: timestamptz("next_available_at").notNull().defaultNow(),
    /** mission_inbox | infraforge | mailforge | google_workspace | … (architecture §14.7). */
    infraVendor: text("infra_vendor").notNull(),
    warmupStatus: text("warmup_status", { enum: WARMUP_STATUSES }).notNull().default("warming"),
    warmupStartedAt: timestamptz("warmup_started_at"),
    rampSchedule: jsonb("ramp_schedule").$type<RampStep[]>(),
    b2bOnly: boolean("b2b_only").notNull().default(true),
    lastSendAt: timestamptz("last_send_at"),
    lastSyncAt: timestamptz("last_sync_at"),
    ...timestamps,
  },
  (t) => [
    unique("mailboxes_workspace_id_id_key").on(t.workspaceId, t.id),
    uniqueIndex("mailboxes_ws_email_uq").on(t.workspaceId, sql`lower(${t.emailAddress})`),
    foreignKey({
      name: "mailboxes_connection_fk",
      columns: [t.workspaceId, t.providerConnectionId],
      foreignColumns: [providerConnections.workspaceId, providerConnections.id],
    }),
    check("mailboxes_status_check", inList(t.status, MAILBOX_STATUSES)),
    check("mailboxes_warmup_status_check", inList(t.warmupStatus, WARMUP_STATUSES)),
    check("mailboxes_daily_limit_check", sql`${t.dailySendLimit} between 1 and 2000`),
    check("mailboxes_min_gap_check", sql`${t.minSecondsBetweenSends} >= 0`),
    check("mailboxes_window_check", sql`${t.windowStart} < ${t.windowEnd}`),
    check("mailboxes_send_days_check", sql`${t.sendDays} <@ '{1,2,3,4,5,6,7}'::smallint[]`),
  ],
);

export const sendingIdentities = appSchema.table(
  "sending_identities",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull(),
    mailboxId: uuid("mailbox_id").notNull(),
    fromName: text("from_name").notNull(),
    fromEmail: text("from_email").notNull(),
    replyToEmail: text("reply_to_email"),
    isDefault: boolean("is_default").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    unique("sending_identities_workspace_id_id_key").on(t.workspaceId, t.id),
    foreignKey({
      name: "sending_identities_mailbox_fk",
      columns: [t.workspaceId, t.mailboxId],
      foreignColumns: [mailboxes.workspaceId, mailboxes.id],
    }),
    uniqueIndex("sending_identities_default_uq")
      .on(t.mailboxId)
      .where(sql`${t.isDefault}`),
  ],
);

/** Atomic daily-cap enforcement (architecture §12). Service-only table. */
export const mailboxDailyUsage = appSchema.table(
  "mailbox_daily_usage",
  {
    mailboxId: uuid("mailbox_id")
      .notNull()
      .references(() => mailboxes.id),
    usageDate: date("usage_date").notNull(),
    sentCount: integer("sent_count").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.mailboxId, t.usageDate] }),
    check("mailbox_daily_usage_count_check", sql`${t.sentCount} >= 0`),
  ],
);
