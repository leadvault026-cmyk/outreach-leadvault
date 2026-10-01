import "server-only";
import { and, asc, desc, eq, isNull, or } from "drizzle-orm";
import { withUserContext } from "@/db/client";
import { auditLogs, jurisdictionPolicies, profiles, workspaceMembers, workspaces } from "@/db/schema";
import type { WorkspaceContext } from "../workspace";

export async function loadWorkspaceDetails(ctx: WorkspaceContext) {
  return withUserContext(ctx.user.userId, async (tx) => {
    const rows = await tx
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, ctx.workspace.id))
      .limit(1);
    return rows[0] ?? null;
  });
}

export async function loadTeam(ctx: WorkspaceContext) {
  return withUserContext(ctx.user.userId, (tx) =>
    tx
      .select({
        userId: workspaceMembers.userId,
        role: workspaceMembers.role,
        status: workspaceMembers.status,
        joinedAt: workspaceMembers.createdAt,
        fullName: profiles.fullName,
        email: profiles.email,
      })
      .from(workspaceMembers)
      .leftJoin(profiles, eq(profiles.userId, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, ctx.workspace.id))
      .orderBy(asc(workspaceMembers.role), asc(profiles.fullName)),
  );
}

export async function loadJurisdictionPolicies(ctx: WorkspaceContext) {
  return withUserContext(ctx.user.userId, (tx) =>
    tx
      .select()
      .from(jurisdictionPolicies)
      .where(
        or(
          isNull(jurisdictionPolicies.workspaceId),
          eq(jurisdictionPolicies.workspaceId, ctx.workspace.id),
        ),
      )
      .orderBy(asc(jurisdictionPolicies.countryCode), asc(jurisdictionPolicies.regionCode)),
  );
}

/** RLS restricts audit rows to ADMIN+; callers also check the `audit.view` capability. */
export async function loadAuditLog(ctx: WorkspaceContext, limit = 100) {
  return withUserContext(ctx.user.userId, (tx) =>
    tx
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        actorEmail: auditLogs.actorEmail,
        actorType: auditLogs.actorType,
        entityType: auditLogs.entityType,
        metadata: auditLogs.metadata,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .where(and(eq(auditLogs.workspaceId, ctx.workspace.id)))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit),
  );
}

/** The caller's own workspace-less events (sign-ins, password changes). */
export async function loadMyAccountEvents(userId: string, limit = 10) {
  return withUserContext(userId, (tx) =>
    tx
      .select({ id: auditLogs.id, action: auditLogs.action, createdAt: auditLogs.createdAt })
      .from(auditLogs)
      .where(and(isNull(auditLogs.workspaceId), eq(auditLogs.actorUserId, userId)))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit),
  );
}
