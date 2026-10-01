import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppDatabase } from "@/db/rls";
import { audienceMembers, audiences, prospectOutreachState, prospects } from "@/db/schema";
import type { EligibilityStatus } from "@/domain/enums";

/**
 * Audiences are static, workspace-owned prospect groups for later campaigns (architecture §11).
 * Membership never overrides suppression or eligibility: a campaign launch re-checks every
 * member. Eligibility counts are computed from the cached decisions (not copied onto audiences).
 */

export const audienceInputSchema = z.object({
  name: z.string().trim().min(2, "Name the audience (at least 2 characters).").max(120),
  description: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => v || null),
});

/** Which selected prospects to add. */
export const INCLUDE_POLICIES = ["eligible", "eligible_and_review", "all"] as const;
export type IncludePolicy = (typeof INCLUDE_POLICIES)[number];

export class AudienceError extends Error {
  constructor(
    public readonly code: "DUPLICATE_NAME" | "NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "AudienceError";
  }
}

const isUnique = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err.code === "23505" || err.cause?.code === "23505";
};

export type EligibilityCounts = Record<EligibilityStatus, number> & {
  total: number;
  unknown: number;
};

function emptyCounts(): EligibilityCounts {
  return { total: 0, ELIGIBLE: 0, NEEDS_REVIEW: 0, INELIGIBLE: 0, SUPPRESSED: 0, unknown: 0 };
}

export async function listAudiences(db: AppDatabase, workspaceId: string) {
  const rows = await db
    .select({
      id: audiences.id,
      name: audiences.name,
      description: audiences.description,
      createdAt: audiences.createdAt,
      updatedAt: audiences.updatedAt,
    })
    .from(audiences)
    .where(and(eq(audiences.workspaceId, workspaceId), isNull(audiences.archivedAt)))
    .orderBy(asc(audiences.name));
  const counts = await db
    .select({
      audienceId: audienceMembers.audienceId,
      e: prospectOutreachState.eligibility,
      n: sql<number>`count(*)::int`,
    })
    .from(audienceMembers)
    .leftJoin(
      prospectOutreachState,
      eq(prospectOutreachState.prospectId, audienceMembers.prospectId),
    )
    .where(eq(audienceMembers.workspaceId, workspaceId))
    .groupBy(audienceMembers.audienceId, prospectOutreachState.eligibility);
  const byAudience = new Map<string, EligibilityCounts>();
  for (const c of counts) {
    const entry = byAudience.get(c.audienceId) ?? emptyCounts();
    entry.total += c.n;
    if (c.e) entry[c.e] += c.n;
    else entry.unknown += c.n;
    byAudience.set(c.audienceId, entry);
  }
  return rows.map((r) => ({ ...r, counts: byAudience.get(r.id) ?? emptyCounts() }));
}

export async function getAudience(db: AppDatabase, workspaceId: string, audienceId: string) {
  const [a] = await db
    .select()
    .from(audiences)
    .where(
      and(
        eq(audiences.workspaceId, workspaceId),
        eq(audiences.id, audienceId),
        isNull(audiences.archivedAt),
      ),
    )
    .limit(1);
  if (!a) return null;
  const rows = await db
    .select({ e: prospectOutreachState.eligibility, n: sql<number>`count(*)::int` })
    .from(audienceMembers)
    .leftJoin(
      prospectOutreachState,
      eq(prospectOutreachState.prospectId, audienceMembers.prospectId),
    )
    .where(
      and(eq(audienceMembers.workspaceId, workspaceId), eq(audienceMembers.audienceId, audienceId)),
    )
    .groupBy(prospectOutreachState.eligibility);
  const counts = emptyCounts();
  for (const r of rows) {
    counts.total += r.n;
    if (r.e) counts[r.e] += r.n;
    else counts.unknown += r.n;
  }
  return { audience: a, counts };
}

export async function createAudience(
  tx: AppDatabase,
  actor: { workspaceId: string; userId: string },
  input: z.input<typeof audienceInputSchema>,
): Promise<string> {
  const data = audienceInputSchema.parse(input);
  try {
    const [row] = await tx
      .insert(audiences)
      .values({
        workspaceId: actor.workspaceId,
        name: data.name,
        description: data.description,
        createdBy: actor.userId,
      })
      .returning({ id: audiences.id });
    return row!.id;
  } catch (e) {
    if (isUnique(e))
      throw new AudienceError("DUPLICATE_NAME", "An audience with this name already exists.");
    throw e;
  }
}

export async function updateAudience(
  tx: AppDatabase,
  actor: { workspaceId: string },
  audienceId: string,
  input: z.input<typeof audienceInputSchema>,
): Promise<void> {
  const data = audienceInputSchema.parse(input);
  try {
    const rows = await tx
      .update(audiences)
      .set({ name: data.name, description: data.description })
      .where(
        and(
          eq(audiences.workspaceId, actor.workspaceId),
          eq(audiences.id, audienceId),
          isNull(audiences.archivedAt),
        ),
      )
      .returning({ id: audiences.id });
    if (!rows.length) throw new AudienceError("NOT_FOUND", "Audience not found.");
  } catch (e) {
    if (isUnique(e))
      throw new AudienceError("DUPLICATE_NAME", "An audience with this name already exists.");
    throw e;
  }
}

export type AddMembersResult = {
  selected: number;
  added: number;
  alreadyMembers: number;
  /** Selected prospects NOT added because of the include policy, by eligibility. */
  excluded: Record<EligibilityStatus | "UNKNOWN", number>;
  /** Selected ids that were not found in this workspace (e.g. tampered or deleted). */
  notFound: number;
};

export async function addMembers(
  tx: AppDatabase,
  actor: { workspaceId: string; userId: string },
  audienceId: string,
  prospectIds: readonly string[],
  include: IncludePolicy,
): Promise<AddMembersResult> {
  const exists = await getAudience(tx, actor.workspaceId, audienceId);
  if (!exists) throw new AudienceError("NOT_FOUND", "Audience not found.");
  const unique = [...new Set(prospectIds)];
  const result: AddMembersResult = {
    selected: unique.length,
    added: 0,
    alreadyMembers: 0,
    excluded: { ELIGIBLE: 0, NEEDS_REVIEW: 0, INELIGIBLE: 0, SUPPRESSED: 0, UNKNOWN: 0 },
    notFound: 0,
  };
  const allowed = (e: EligibilityStatus | null) =>
    include === "all" ||
    e === "ELIGIBLE" ||
    (include === "eligible_and_review" && e === "NEEDS_REVIEW");

  for (let i = 0; i < unique.length; i += 1000) {
    const chunk = unique.slice(i, i + 1000);
    const found = await tx
      .select({ id: prospects.id, e: prospectOutreachState.eligibility })
      .from(prospects)
      .leftJoin(prospectOutreachState, eq(prospectOutreachState.prospectId, prospects.id))
      .where(
        and(
          eq(prospects.workspaceId, actor.workspaceId),
          inArray(prospects.id, chunk),
          isNull(prospects.archivedAt),
        ),
      );
    result.notFound += chunk.length - found.length;
    const toAdd = found.filter((f) => {
      if (allowed(f.e)) return true;
      result.excluded[f.e ?? "UNKNOWN"]++;
      return false;
    });
    if (!toAdd.length) continue;
    const inserted = await tx
      .insert(audienceMembers)
      .values(
        toAdd.map((f) => ({
          audienceId,
          prospectId: f.id,
          workspaceId: actor.workspaceId,
          addedVia: "manual" as const,
          addedBy: actor.userId,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: audienceMembers.prospectId });
    result.added += inserted.length;
    result.alreadyMembers += toAdd.length - inserted.length;
  }
  if (result.added)
    await tx.update(audiences).set({ updatedAt: new Date() }).where(eq(audiences.id, audienceId));
  return result;
}

export async function removeMembers(
  tx: AppDatabase,
  actor: { workspaceId: string },
  audienceId: string,
  prospectIds: readonly string[],
): Promise<number> {
  let removed = 0;
  const unique = [...new Set(prospectIds)];
  for (let i = 0; i < unique.length; i += 1000) {
    const rows = await tx
      .delete(audienceMembers)
      .where(
        and(
          eq(audienceMembers.workspaceId, actor.workspaceId),
          eq(audienceMembers.audienceId, audienceId),
          inArray(audienceMembers.prospectId, unique.slice(i, i + 1000)),
        ),
      )
      .returning({ id: audienceMembers.prospectId });
    removed += rows.length;
  }
  if (removed)
    await tx.update(audiences).set({ updatedAt: new Date() }).where(eq(audiences.id, audienceId));
  return removed;
}
