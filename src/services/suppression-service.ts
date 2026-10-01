import { and, desc, eq, ilike, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import type { AppDatabase } from "@/db/rls";
import { suppressions } from "@/db/schema";
import { normalizeSuppressionValue } from "@/domain/suppression";
import { refreshEligibility, workspacesWithValue } from "./eligibility-service";

export type SuppressionFilters = {
  q?: string;
  scope?: "workspace" | "global";
  status?: "active" | "lifted";
  reason?: string;
  page: number;
  size: number;
};

/** Workspace suppressions plus LeadVault-wide (global) ones visible to members. */
export async function listSuppressions(
  db: AppDatabase,
  workspaceId: string,
  f: SuppressionFilters,
) {
  const conds: Array<SQL | undefined> = [
    or(eq(suppressions.workspaceId, workspaceId), eq(suppressions.scope, "global")),
  ];
  if (f.scope) conds.push(eq(suppressions.scope, f.scope));
  if (f.status === "active") conds.push(isNull(suppressions.liftedAt));
  if (f.status === "lifted") conds.push(isNotNull(suppressions.liftedAt));
  if (f.reason) conds.push(eq(suppressions.reason, f.reason as never));
  if (f.q)
    conds.push(
      ilike(
        suppressions.valueNormalized,
        `%${f.q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`,
      ),
    );
  const where = and(...conds);
  const [{ total } = { total: 0 }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(suppressions)
    .where(where);
  const rows = await db
    .select({
      id: suppressions.id,
      scope: suppressions.scope,
      valueType: suppressions.valueType,
      value: suppressions.valueNormalized,
      reason: suppressions.reason,
      source: suppressions.source,
      note: suppressions.note,
      createdAt: suppressions.createdAt,
      liftedAt: suppressions.liftedAt,
      liftReason: suppressions.liftReason,
      // Actor emails only for this workspace's own records (global origins are not disclosed).
      createdByEmail: sql<
        string | null
      >`case when ${suppressions.scope} = 'workspace' then (select p.email from app.profiles p where p.user_id = ${suppressions.createdBy}) end`,
      liftedByEmail: sql<
        string | null
      >`case when ${suppressions.scope} = 'workspace' then (select p.email from app.profiles p where p.user_id = ${suppressions.liftedBy}) end`,
    })
    .from(suppressions)
    .where(where)
    .orderBy(sql`${suppressions.liftedAt} is not null`, desc(suppressions.createdAt))
    .limit(f.size)
    .offset((f.page - 1) * f.size);
  return { total, rows };
}

export class SuppressionError extends Error {
  constructor(
    public readonly code: "INVALID_VALUE" | "ALREADY_SUPPRESSED" | "NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "SuppressionError";
  }
}

function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } };
  return err.code === "23505" || err.cause?.code === "23505";
}

type AddInput = {
  valueType: "email" | "domain";
  value: string;
  reason: "MANUAL_DO_NOT_CONTACT" | "COMPLIANCE" | "UNSUBSCRIBE";
  note: string;
};

/** Workspace-scoped suppression, written under the caller's RLS context. */
export async function addWorkspaceSuppression(
  tx: AppDatabase,
  actor: { workspaceId: string; userId: string },
  input: AddInput,
): Promise<{ id: string; value: string; reevaluated: number }> {
  const v = normalizeSuppressionValue(input.valueType, input.value);
  if (!v.ok) throw new SuppressionError("INVALID_VALUE", v.message);
  let id: string;
  try {
    [{ id }] = (await tx
      .insert(suppressions)
      .values({
        scope: "workspace",
        workspaceId: actor.workspaceId,
        valueType: input.valueType,
        valueNormalized: v.value,
        reason: input.reason,
        source: "manual",
        note: input.note,
        createdBy: actor.userId,
      })
      .returning({ id: suppressions.id })) as [{ id: string }];
  } catch (e) {
    if (isUniqueViolation(e))
      throw new SuppressionError(
        "ALREADY_SUPPRESSED",
        "This value is already suppressed in this workspace.",
      );
    throw e;
  }
  const reevaluated = await refreshEligibility(tx, actor.workspaceId, {
    kind: "value",
    valueType: input.valueType,
    value: v.value,
  });
  return { id, value: v.value, reevaluated };
}

/**
 * LeadVault-wide suppression. PRIVILEGED: callers must have verified platform-admin rights; the
 * database refuses global writes from user sessions. Re-evaluates every affected workspace.
 */
export async function addGlobalSuppression(
  system: AppDatabase,
  actor: { userId: string },
  input: AddInput,
): Promise<{ id: string; value: string; reevaluated: number }> {
  const v = normalizeSuppressionValue(input.valueType, input.value);
  if (!v.ok) throw new SuppressionError("INVALID_VALUE", v.message);
  let id: string;
  try {
    [{ id }] = (await system
      .insert(suppressions)
      .values({
        scope: "global",
        workspaceId: null,
        valueType: input.valueType,
        valueNormalized: v.value,
        reason: input.reason,
        source: "manual",
        note: input.note,
        createdBy: actor.userId,
      })
      .returning({ id: suppressions.id })) as [{ id: string }];
  } catch (e) {
    if (isUniqueViolation(e))
      throw new SuppressionError(
        "ALREADY_SUPPRESSED",
        "This value is already on the LeadVault-wide list.",
      );
    throw e;
  }
  let reevaluated = 0;
  for (const ws of await workspacesWithValue(system, input.valueType, v.value)) {
    reevaluated += await refreshEligibility(system, ws, {
      kind: "value",
      valueType: input.valueType,
      value: v.value,
    });
  }
  return { id, value: v.value, reevaluated };
}

export async function getSuppression(db: AppDatabase, id: string) {
  const [row] = await db.select().from(suppressions).where(eq(suppressions.id, id)).limit(1);
  return row ?? null;
}

/** Lift a workspace suppression under the caller's RLS context (ADMIN+ by policy). */
export async function liftWorkspaceSuppression(
  tx: AppDatabase,
  actor: { workspaceId: string; userId: string },
  suppressionId: string,
  reason: string,
) {
  const rows = await tx
    .update(suppressions)
    .set({ liftedAt: new Date(), liftedBy: actor.userId, liftReason: reason })
    .where(
      and(
        eq(suppressions.id, suppressionId),
        eq(suppressions.scope, "workspace"),
        eq(suppressions.workspaceId, actor.workspaceId),
        isNull(suppressions.liftedAt),
      ),
    )
    .returning({ valueType: suppressions.valueType, value: suppressions.valueNormalized });
  const row = rows[0];
  if (!row)
    throw new SuppressionError("NOT_FOUND", "Active suppression not found in this workspace.");
  const reevaluated = await refreshEligibility(tx, actor.workspaceId, {
    kind: "value",
    valueType: row.valueType,
    value: row.value,
  });
  return { ...row, reevaluated };
}

/** Lift a global suppression. PRIVILEGED (platform admin verified by the caller). */
export async function liftGlobalSuppression(
  system: AppDatabase,
  actor: { userId: string },
  suppressionId: string,
  reason: string,
) {
  const rows = await system
    .update(suppressions)
    .set({ liftedAt: new Date(), liftedBy: actor.userId, liftReason: reason })
    .where(
      and(
        eq(suppressions.id, suppressionId),
        eq(suppressions.scope, "global"),
        isNull(suppressions.liftedAt),
      ),
    )
    .returning({ valueType: suppressions.valueType, value: suppressions.valueNormalized });
  const row = rows[0];
  if (!row) throw new SuppressionError("NOT_FOUND", "Active LeadVault-wide suppression not found.");
  let reevaluated = 0;
  for (const ws of await workspacesWithValue(system, row.valueType, row.value)) {
    reevaluated += await refreshEligibility(system, ws, {
      kind: "value",
      valueType: row.valueType,
      value: row.value,
    });
  }
  return { ...row, reevaluated };
}
