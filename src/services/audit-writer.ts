import type { AppDatabase } from "@/db/rls";
import { auditLogs } from "@/db/schema";
import { sanitizeAuditMetadata, type AuditAction } from "@/domain/audit";

/**
 * Audit entries written by the worker and public endpoints (no user request context). User
 * actions keep using src/server/audit.ts. Metadata is sanitized the same way.
 */
export async function writeAudit(
  db: AppDatabase,
  entry: {
    actorType: "system" | "worker";
    action: AuditAction;
    entityType: string;
    entityId?: string | null;
    workspaceId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(auditLogs).values({
    workspaceId: entry.workspaceId ?? null,
    actorType: entry.actorType,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    metadata: sanitizeAuditMetadata(entry.metadata),
  });
}
