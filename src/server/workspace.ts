import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { cache } from "react";
import { withUserContext } from "@/db/client";
import { workspaceMembers, workspaces } from "@/db/schema";
import { AUDIT_ACTIONS } from "@/domain/audit";
import type { WorkspaceRole } from "@/domain/enums";
import { can, type Capability } from "@/domain/permissions";
import { recordSystemAudit } from "./audit";
import { requireUser, type SessionUser } from "./auth";

export const LAST_WORKSPACE_COOKIE = "lvo_last_ws";

export type WorkspaceSummary = {
  id: string;
  slug: string;
  name: string;
  isDemo: boolean;
  kind: "internal" | "client";
  role: WorkspaceRole;
};

export type WorkspaceContext = {
  user: SessionUser;
  workspace: WorkspaceSummary & { defaultTimezone: string };
  role: WorkspaceRole;
};

/** Workspaces the user is an active member of. Runs under RLS. */
export const listMyWorkspaces = cache(async (): Promise<WorkspaceSummary[]> => {
  const user = await requireUser();
  return withUserContext(user.userId, (tx) =>
    tx
      .select({
        id: workspaces.id,
        slug: workspaces.slug,
        name: workspaces.name,
        isDemo: workspaces.isDemo,
        kind: workspaces.kind,
        role: workspaceMembers.role,
      })
      .from(workspaces)
      .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(
        and(
          eq(workspaceMembers.userId, user.userId),
          eq(workspaceMembers.status, "active"),
          isNull(workspaces.archivedAt),
        ),
      )
      .orderBy(asc(workspaces.name)),
  );
});

export type WorkspaceResolution =
  { ok: true; context: WorkspaceContext } | { ok: false; reason: "not_available" };

/**
 * Resolve a workspace by slug for the signed-in user. Non-membership and non-existence produce
 * the same result, so workspace existence is never revealed. Denials are audited.
 */
export const resolveWorkspace = cache(async (slug: string): Promise<WorkspaceResolution> => {
  const user = await requireUser();
  const normalized = slug.toLowerCase();

  const rows = await withUserContext(user.userId, (tx) =>
    tx
      .select({
        id: workspaces.id,
        slug: workspaces.slug,
        name: workspaces.name,
        isDemo: workspaces.isDemo,
        kind: workspaces.kind,
        defaultTimezone: workspaces.defaultTimezone,
        role: workspaceMembers.role,
      })
      .from(workspaces)
      .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(
        and(
          eq(workspaces.slug, normalized),
          eq(workspaceMembers.userId, user.userId),
          eq(workspaceMembers.status, "active"),
          isNull(workspaces.archivedAt),
        ),
      )
      .limit(1),
  );

  const row = rows[0];
  if (!row) {
    await recordSystemAudit(user, {
      action: AUDIT_ACTIONS.workspaceAccessDenied,
      entityType: "workspace",
      metadata: { requested_slug: normalized.slice(0, 64) },
    });
    return { ok: false, reason: "not_available" };
  }

  return { ok: true, context: { user, workspace: row, role: row.role } };
});

/** For server actions: resolve + require a capability, or throw a safe error. */
export async function requireCapability(
  slug: string,
  capability: Capability,
): Promise<WorkspaceContext> {
  const resolution = await resolveWorkspace(slug);
  if (!resolution.ok || !can(resolution.context.role, capability)) {
    throw new AuthorizationError();
  }
  return resolution.context;
}

export class AuthorizationError extends Error {
  constructor() {
    super("You do not have permission to perform this action.");
    this.name = "AuthorizationError";
  }
}

/** Default landing workspace: last used (if still a member), else the first alphabetically. */
export async function defaultWorkspaceSlug(): Promise<string | null> {
  const mine = await listMyWorkspaces();
  if (mine.length === 0) return null;
  const last = (await cookies()).get(LAST_WORKSPACE_COOKIE)?.value;
  return mine.find((w) => w.slug === last)?.slug ?? mine[0]!.slug;
}
