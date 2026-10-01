import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import type { AppDatabase } from "@/db/rls";
import {
  audienceMembers,
  audiences,
  prospectImportRows,
  prospectImports,
  prospectOutreachState,
  prospects,
  suppressions,
  unsubscribes,
} from "@/db/schema";
import type { EligibilityStatus } from "@/domain/enums";
import type { ProspectFilters } from "@/domain/prospects/filters";
import { DEFAULT_VERIFICATION_MAX_AGE_DAYS } from "@/domain/verification";
import { evaluateSubject, loadPolicies, loadSuppressionContext } from "./eligibility-service";

/** Escape LIKE metacharacters in user search input. */
function likeTerm(word: string): string {
  return `%${word.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** WHERE clause for the shared prospect filters (always scoped to one workspace). */
export function prospectWhere(workspaceId: string, f: ProspectFilters, now = new Date()): SQL {
  const conds: Array<SQL | undefined> = [
    eq(prospects.workspaceId, workspaceId),
    isNull(prospects.archivedAt),
  ];

  if (f.q) {
    for (const word of f.q.split(/\s+/).filter(Boolean).slice(0, 6)) {
      conds.push(sql`${prospects.searchText} like ${likeTerm(word)}`);
    }
  }
  if (f.eligibility) {
    conds.push(
      sql`exists (select 1 from app.prospect_outreach_state s where s.prospect_id = "app"."prospects"."id" and s.eligibility = ${f.eligibility})`,
    );
  }
  if (f.verification) {
    const staleBefore = new Date(
      now.getTime() - DEFAULT_VERIFICATION_MAX_AGE_DAYS * 86_400_000,
    ).toISOString();
    if (f.verification === "STALE") {
      conds.push(
        sql`(${prospects.emailVerificationStatus} = 'STALE' or (${prospects.emailVerificationStatus} in ('VERIFIED', 'RISKY') and ${prospects.emailVerifiedAt} < ${staleBefore}::timestamptz))`,
      );
    } else if (f.verification === "VERIFIED" || f.verification === "RISKY") {
      conds.push(
        sql`(${prospects.emailVerificationStatus} = ${f.verification} and ${prospects.emailVerifiedAt} >= ${staleBefore}::timestamptz)`,
      );
    } else {
      conds.push(eq(prospects.emailVerificationStatus, f.verification));
    }
  }
  if (f.country === "none") conds.push(isNull(prospects.countryCode));
  else if (f.country) conds.push(eq(prospects.countryCode, f.country));
  if (f.region) {
    conds.push(
      or(
        eq(prospects.regionCode, f.region.toUpperCase()),
        sql`lower(${prospects.state}) = ${f.region.toLowerCase()}`,
      ),
    );
  }
  if (f.type) conds.push(eq(prospects.businessType, f.type));
  for (const h of f.has) {
    if (h === "contact") conds.push(isNotNull(prospects.contactName));
    if (h === "title") conds.push(isNotNull(prospects.contactTitle));
    if (h === "phone") conds.push(isNotNull(prospects.phone));
    if (h === "evidence") conds.push(isNotNull(prospects.evidenceUrl));
    if (h === "email") conds.push(isNotNull(prospects.emailNormalized));
  }
  if (f.import) {
    conds.push(
      sql`exists (select 1 from app.prospect_import_rows r where r.prospect_id = "app"."prospects"."id" and r.import_id = ${f.import})`,
    );
  }
  if (f.audience) {
    conds.push(
      sql`exists (select 1 from app.audience_members m where m.prospect_id = "app"."prospects"."id" and m.audience_id = ${f.audience})`,
    );
  }
  return and(...conds)!;
}

const ELIGIBILITY_ORDER = sql`case ${prospectOutreachState.eligibility} when 'ELIGIBLE' then 1 when 'NEEDS_REVIEW' then 2 when 'INELIGIBLE' then 3 when 'SUPPRESSED' then 4 else 5 end`;

function orderBy(f: ProspectFilters): SQL[] {
  const dir = f.dir ?? (f.sort === "updated" ? "desc" : "asc");
  const d = (c: Parameters<typeof asc>[0]) => (dir === "asc" ? asc(c) : desc(c));
  switch (f.sort) {
    case "company":
      return [d(prospects.companyName), asc(prospects.id)];
    case "contact":
      return [d(prospects.contactName), asc(prospects.id)];
    case "location":
      return [d(prospects.countryCode), d(prospects.state), d(prospects.city), asc(prospects.id)];
    case "eligibility":
      return [
        dir === "asc" ? asc(ELIGIBILITY_ORDER) : desc(ELIGIBILITY_ORDER),
        asc(prospects.companyName),
        asc(prospects.id),
      ];
    default:
      return [d(prospects.updatedAt), asc(prospects.id)];
  }
}

export type ProspectListRow = Awaited<ReturnType<typeof listProspects>>["rows"][number];

export async function listProspects(
  db: AppDatabase,
  workspaceId: string,
  f: ProspectFilters,
  now = new Date(),
) {
  const where = prospectWhere(workspaceId, f, now);
  const [{ total } = { total: 0 }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(prospects)
    .where(where);
  const rows = await db
    .select({
      id: prospects.id,
      companyName: prospects.companyName,
      websiteDomain: prospects.websiteDomain,
      contactName: prospects.contactName,
      contactTitle: prospects.contactTitle,
      email: prospects.emailNormalized,
      city: prospects.city,
      state: prospects.state,
      countryCode: prospects.countryCode,
      businessType: prospects.businessType,
      verificationStatus: prospects.emailVerificationStatus,
      verifiedAt: prospects.emailVerifiedAt,
      updatedAt: prospects.updatedAt,
      eligibility: prospectOutreachState.eligibility,
      reasons: prospectOutreachState.eligibilityReasons,
    })
    .from(prospects)
    .leftJoin(prospectOutreachState, eq(prospectOutreachState.prospectId, prospects.id))
    .where(where)
    .orderBy(...orderBy(f))
    .limit(f.size)
    .offset((f.page - 1) * f.size);
  return { total, rows };
}

/** Ids matching the filters (for "select all matching"), bounded. */
export async function selectProspectIds(
  db: AppDatabase,
  workspaceId: string,
  f: ProspectFilters,
  limit = 10_000,
) {
  const rows = await db
    .select({ id: prospects.id })
    .from(prospects)
    .where(prospectWhere(workspaceId, f))
    .orderBy(asc(prospects.id))
    .limit(limit + 1);
  return { ids: rows.slice(0, limit).map((r) => r.id), truncated: rows.length > limit };
}

/** Eligibility breakdown of a set of prospects (cached decisions; refreshed by callers first). */
export async function eligibilityBreakdown(
  db: AppDatabase,
  workspaceId: string,
  ids: readonly string[],
) {
  const counts: Record<EligibilityStatus | "UNKNOWN", number> = {
    ELIGIBLE: 0,
    NEEDS_REVIEW: 0,
    INELIGIBLE: 0,
    SUPPRESSED: 0,
    UNKNOWN: 0,
  };
  for (let i = 0; i < ids.length; i += 2000) {
    const chunk = ids.slice(i, i + 2000);
    const rows = await db
      .select({ e: prospectOutreachState.eligibility, n: sql<number>`count(*)::int` })
      .from(prospects)
      .leftJoin(prospectOutreachState, eq(prospectOutreachState.prospectId, prospects.id))
      .where(and(eq(prospects.workspaceId, workspaceId), inArray(prospects.id, [...chunk])))
      .groupBy(prospectOutreachState.eligibility);
    for (const r of rows) counts[r.e ?? "UNKNOWN"] += r.n;
  }
  return counts;
}

export async function prospectFacets(db: AppDatabase, workspaceId: string) {
  const ws = and(eq(prospects.workspaceId, workspaceId), isNull(prospects.archivedAt));
  const [countries, types, regions, imports, auds, totals] = await Promise.all([
    db
      .select({ code: prospects.countryCode, n: sql<number>`count(*)::int` })
      .from(prospects)
      .where(ws)
      .groupBy(prospects.countryCode)
      .orderBy(desc(sql`count(*)`)),
    db
      .select({ type: prospects.businessType, n: sql<number>`count(*)::int` })
      .from(prospects)
      .where(and(ws, isNotNull(prospects.businessType)))
      .groupBy(prospects.businessType)
      .orderBy(desc(sql`count(*)`))
      .limit(60),
    db
      .select({ region: prospects.regionCode, n: sql<number>`count(*)::int` })
      .from(prospects)
      .where(and(ws, isNotNull(prospects.regionCode)))
      .groupBy(prospects.regionCode)
      .orderBy(asc(prospects.regionCode)),
    db
      .select({
        id: prospectImports.id,
        label: prospectImports.sourceLabel,
        createdAt: prospectImports.createdAt,
      })
      .from(prospectImports)
      .where(
        and(
          eq(prospectImports.workspaceId, workspaceId),
          inArray(prospectImports.status, ["completed", "completed_with_issues"]),
        ),
      )
      .orderBy(desc(prospectImports.createdAt))
      .limit(50),
    db
      .select({ id: audiences.id, name: audiences.name })
      .from(audiences)
      .where(and(eq(audiences.workspaceId, workspaceId), isNull(audiences.archivedAt)))
      .orderBy(asc(audiences.name)),
    db
      .select({ e: prospectOutreachState.eligibility, n: sql<number>`count(*)::int` })
      .from(prospectOutreachState)
      .where(eq(prospectOutreachState.workspaceId, workspaceId))
      .groupBy(prospectOutreachState.eligibility),
  ]);
  return { countries, types, regions, imports, audiences: auds, totals };
}

export async function getProspectDetail(
  db: AppDatabase,
  workspaceId: string,
  prospectId: string,
  now = new Date(),
) {
  const [p] = await db
    .select()
    .from(prospects)
    .where(and(eq(prospects.workspaceId, workspaceId), eq(prospects.id, prospectId)))
    .limit(1);
  if (!p) return null;

  const [state] = await db
    .select()
    .from(prospectOutreachState)
    .where(
      and(
        eq(prospectOutreachState.workspaceId, workspaceId),
        eq(prospectOutreachState.prospectId, prospectId),
      ),
    )
    .limit(1);

  const memberships = await db
    .select({ id: audiences.id, name: audiences.name, addedAt: audienceMembers.addedAt })
    .from(audienceMembers)
    .innerJoin(audiences, eq(audiences.id, audienceMembers.audienceId))
    .where(
      and(eq(audienceMembers.workspaceId, workspaceId), eq(audienceMembers.prospectId, prospectId)),
    )
    .orderBy(asc(audiences.name));

  const provenance = await db
    .select({
      importId: prospectImports.id,
      label: prospectImports.sourceLabel,
      fileName: prospectImports.fileName,
      rowNumber: prospectImportRows.rowNumber,
      outcome: prospectImportRows.outcome,
      importedAt: prospectImports.completedAt,
    })
    .from(prospectImportRows)
    .innerJoin(prospectImports, eq(prospectImports.id, prospectImportRows.importId))
    .where(
      and(
        eq(prospectImportRows.workspaceId, workspaceId),
        eq(prospectImportRows.prospectId, prospectId),
      ),
    )
    .orderBy(desc(prospectImports.createdAt))
    .limit(20);

  const values = [p.emailNormalized, p.emailDomain].filter((v): v is string => Boolean(v));
  const suppressionHistory = values.length
    ? await db
        .select()
        .from(suppressions)
        .where(
          and(
            inArray(suppressions.valueNormalized, values),
            or(eq(suppressions.scope, "global"), eq(suppressions.workspaceId, workspaceId)),
          ),
        )
        .orderBy(desc(suppressions.createdAt))
    : [];
  const unsubscribeHistory = p.emailNormalized
    ? await db
        .select()
        .from(unsubscribes)
        .where(
          and(
            eq(unsubscribes.workspaceId, workspaceId),
            eq(unsubscribes.emailNormalized, p.emailNormalized),
          ),
        )
        .orderBy(desc(unsubscribes.occurredAt))
    : [];

  // Live evaluation with the authoritative engine (the cached value is shown alongside).
  const policies = await loadPolicies(db, workspaceId);
  const ctx = await loadSuppressionContext(
    db,
    workspaceId,
    p.emailNormalized ? [p.emailNormalized] : [],
    p.emailDomain ? [p.emailDomain] : [],
  );
  const live = evaluateSubject(
    workspaceId,
    {
      companyName: p.companyName,
      contactName: p.contactName,
      email: p.email,
      emailNormalized: p.emailNormalized,
      emailDomain: p.emailDomain,
      websiteDomain: p.websiteDomain,
      verificationStatus: p.emailVerificationStatus,
      verifiedAt: p.emailVerifiedAt,
      countryCode: p.countryCode,
      regionCode: p.regionCode,
    },
    policies,
    ctx,
    now,
  );

  return {
    prospect: p,
    state: state ?? null,
    memberships,
    provenance,
    suppressionHistory,
    unsubscribeHistory,
    live,
  };
}
