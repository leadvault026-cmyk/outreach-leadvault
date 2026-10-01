import "server-only";
import { auditLogs } from "@/db/schema";
import type { AppTransaction } from "@/db/rls";
import { privilegedDb } from "@/db/client";
import { sanitizeAuditMetadata, type AuditAction } from "@/domain/audit";
import { getRequestId } from "./request";

type AuditEntry = {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  workspaceId?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * Record an audit event as the signed-in user, inside their RLS transaction. The audit_insert
 * policy requires actor_user_id = caller, so entries cannot be forged for another user.
 */
export async function recordUserAudit(
  tx: AppTransaction,
  actor: { userId: string; email: string | null },
  entry: AuditEntry,
): Promise<void> {
  await tx.insert(auditLogs).values({
    workspaceId: entry.workspaceId ?? null,
    actorType: "user",
    actorUserId: actor.userId,
    actorEmail: actor.email,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    metadata: sanitizeAuditMetadata(entry.metadata),
    requestId: await getRequestId(),
  });
}

/**
 * Record a security event that cannot be written under the user's RLS context (e.g. a denied
 * workspace access attempt). Privileged write; the actor is still attributed.
 */
export async function recordSystemAudit(
  actor: { userId: string | null; email: string | null },
  entry: AuditEntry,
): Promise<void> {
  await privilegedDb()
    .insert(auditLogs)
    .values({
      workspaceId: entry.workspaceId ?? null,
      actorType: actor.userId ? "user" : "system",
      actorUserId: actor.userId,
      actorEmail: actor.email,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      metadata: sanitizeAuditMetadata(entry.metadata),
      requestId: await getRequestId(),
    });
}
