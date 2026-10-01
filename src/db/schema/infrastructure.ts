import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, text, uuid } from "drizzle-orm/pg-core";
import { AUDIT_ACTOR_TYPES, WEBHOOK_EVENT_STATUSES } from "@/domain/enums";
import { appSchema, id, inList, timestamptz } from "./_shared";
import { workspaces } from "./tenancy";

/** Architecture §20. Provider-level; workspace is resolved during processing. Service-only. */
export const webhookEvents = appSchema.table(
  "webhook_events",
  {
    id: id(),
    provider: text("provider").notNull(),
    endpoint: text("endpoint").notNull(),
    providerEventId: text("provider_event_id"),
    dedupeKey: text("dedupe_key").notNull().unique(),
    signatureValid: boolean("signature_valid").notNull(),
    headers: jsonb("headers").$type<Record<string, string>>().notNull(),
    payload: jsonb("payload").notNull(),
    workspaceId: uuid("workspace_id"),
    status: text("status", { enum: WEBHOOK_EVENT_STATUSES }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    receivedAt: timestamptz("received_at").notNull().defaultNow(),
    processedAt: timestamptz("processed_at"),
  },
  (t) => [
    index("webhook_events_pending_idx")
      .on(t.status, t.receivedAt)
      .where(sql`${t.status} in ('received', 'failed')`),
    check("webhook_events_status_check", inList(t.status, WEBHOOK_EVENT_STATUSES)),
  ],
);

/**
 * Architecture §30. Append-only: an UPDATE/DELETE trigger rejects changes for every role
 * (security migration). Metadata is sanitized by src/server/audit before insert.
 */
export const auditLogs = appSchema.table(
  "audit_logs",
  {
    id: id(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id),
    actorType: text("actor_type", { enum: AUDIT_ACTOR_TYPES }).notNull(),
    actorUserId: uuid("actor_user_id"),
    actorEmail: text("actor_email"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    requestId: text("request_id"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_ws_created_idx").on(t.workspaceId, t.createdAt.desc()),
    index("audit_logs_entity_idx").on(t.entityType, t.entityId, t.createdAt.desc()),
    index("audit_logs_actor_idx").on(t.actorUserId, t.createdAt.desc()),
    check("audit_logs_actor_type_check", inList(t.actorType, AUDIT_ACTOR_TYPES)),
    check("audit_logs_action_format", sql`${t.action} ~ '^[a-z_]+(\\.[a-z_]+)+$'`),
    check(
      "audit_logs_user_actor_check",
      sql`${t.actorType} <> 'user' or ${t.actorUserId} is not null`,
    ),
  ],
);

/** Architecture §13 / §27 — worker liveness, surfaced on the System status panel. */
export const workerHeartbeats = appSchema.table("worker_heartbeats", {
  workerId: text("worker_id").primaryKey(),
  service: text("service").notNull(),
  version: text("version").notNull(),
  startedAt: timestamptz("started_at").notNull(),
  lastBeatAt: timestamptz("last_beat_at").notNull(),
  loops: jsonb("loops").$type<Record<string, unknown>>().notNull(),
});
