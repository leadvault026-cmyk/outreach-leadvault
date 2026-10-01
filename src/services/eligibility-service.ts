import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { AppDatabase } from "@/db/rls";
import {
  jurisdictionPolicies,
  prospectOutreachState,
  prospects,
  suppressions,
  unsubscribes,
} from "@/db/schema";
import {
  evaluateEligibility,
  type EligibilityResult,
  type SuppressionMatch,
} from "@/domain/eligibility";
import type { EmailVerificationStatus } from "@/domain/enums";
import type { PolicyRow } from "@/domain/jurisdiction";

/**
 * Loads eligibility inputs in batches and evaluates them with the single domain engine
 * (src/domain/eligibility.ts). Works with either a user RLS transaction or the privileged
 * system connection; every query is scoped by workspace explicitly.
 */

export type EligibilitySubject = {
  id?: string;
  companyName: string | null;
  contactName: string | null;
  email: string | null;
  emailNormalized: string | null;
  emailDomain: string | null;
  websiteDomain: string | null;
  verificationStatus: EmailVerificationStatus;
  verifiedAt: Date | null;
  countryCode: string | null;
  regionCode: string | null;
};

export async function loadPolicies(db: AppDatabase, workspaceId: string): Promise<PolicyRow[]> {
  const rows = await db
    .select()
    .from(jurisdictionPolicies)
    .where(
      or(
        isNull(jurisdictionPolicies.workspaceId),
        eq(jurisdictionPolicies.workspaceId, workspaceId),
      ),
    );
  return rows.map((r) => ({
    scope: r.scope,
    workspaceId: r.workspaceId,
    countryCode: r.countryCode,
    regionCode: r.regionCode,
    outreachStatus: r.outreachStatus,
    requiresPostalAddress: r.requiresPostalAddress,
    requiresUnsubscribeLink: r.requiresUnsubscribeLink,
    footerTemplate: r.footerTemplate,
  }));
}

export type SuppressionContext = {
  matchesFor(emailNormalized: string | null, emailDomain: string | null): SuppressionMatch[];
  isUnsubscribed(emailNormalized: string | null): boolean;
};

/** Active suppressions (workspace + global) and active unsubscribes for a set of addresses. */
export async function loadSuppressionContext(
  db: AppDatabase,
  workspaceId: string,
  emails: readonly string[],
  domains: readonly string[],
): Promise<SuppressionContext> {
  const values = [...new Set([...emails, ...domains])].filter(Boolean);
  const active = values.length
    ? await db
        .select({
          scope: suppressions.scope,
          valueType: suppressions.valueType,
          value: suppressions.valueNormalized,
          reason: suppressions.reason,
        })
        .from(suppressions)
        .where(
          and(
            isNull(suppressions.liftedAt),
            inArray(suppressions.valueNormalized, values),
            or(eq(suppressions.scope, "global"), eq(suppressions.workspaceId, workspaceId)),
          ),
        )
    : [];

  const unsub = emails.length
    ? await db
        .select({ email: unsubscribes.emailNormalized })
        .from(unsubscribes)
        .innerJoin(suppressions, eq(suppressions.id, unsubscribes.suppressionId))
        .where(
          and(
            eq(unsubscribes.workspaceId, workspaceId),
            inArray(unsubscribes.emailNormalized, [...new Set(emails)]),
            isNull(suppressions.liftedAt),
          ),
        )
    : [];
  const unsubscribed = new Set(unsub.map((u) => u.email));

  return {
    matchesFor(email, domain) {
      return active
        .filter(
          (s) =>
            (s.valueType === "email" && s.value === email) ||
            (s.valueType === "domain" && s.value === domain),
        )
        .map((s) => ({ scope: s.scope, reason: s.reason, valueType: s.valueType }));
    },
    isUnsubscribed(email) {
      return email ? unsubscribed.has(email) : false;
    },
  };
}

export function evaluateSubject(
  workspaceId: string,
  subject: EligibilitySubject,
  policies: readonly PolicyRow[],
  ctx: SuppressionContext,
  now = new Date(),
): EligibilityResult {
  return evaluateEligibility(
    {
      workspaceId,
      companyName: subject.companyName,
      contactName: subject.contactName,
      email: subject.email,
      emailNormalized: subject.emailNormalized,
      emailDomain: subject.emailDomain,
      websiteDomain: subject.websiteDomain,
      verificationStatus: subject.verificationStatus,
      verifiedAt: subject.verifiedAt,
      countryCode: subject.countryCode,
      regionCode: subject.regionCode,
      suppressions: ctx.matchesFor(subject.emailNormalized, subject.emailDomain),
      unsubscribed: ctx.isUnsubscribed(subject.emailNormalized),
      policies,
    },
    { now },
  );
}

const subjectColumns = {
  id: prospects.id,
  companyName: prospects.companyName,
  contactName: prospects.contactName,
  email: prospects.email,
  emailNormalized: prospects.emailNormalized,
  emailDomain: prospects.emailDomain,
  websiteDomain: prospects.websiteDomain,
  verificationStatus: prospects.emailVerificationStatus,
  verifiedAt: prospects.emailVerifiedAt,
  countryCode: prospects.countryCode,
  regionCode: prospects.regionCode,
};

/** Upsert cached decisions for the given subjects (prospect_outreach_state). */
export async function writeEligibility(
  db: AppDatabase,
  workspaceId: string,
  results: ReadonlyArray<{ prospectId: string; result: EligibilityResult }>,
  now = new Date(),
): Promise<void> {
  for (let i = 0; i < results.length; i += 500) {
    const chunk = results.slice(i, i + 500);
    if (!chunk.length) continue;
    await db
      .insert(prospectOutreachState)
      .values(
        chunk.map(({ prospectId, result }) => ({
          prospectId,
          workspaceId,
          eligibility: result.status,
          eligibilityReasons: result.reasons,
          eligibilityCheckedAt: now,
          eligibilityExpiresAt: result.expiresAt,
        })),
      )
      .onConflictDoUpdate({
        target: prospectOutreachState.prospectId,
        set: {
          eligibility: sql`excluded.eligibility`,
          eligibilityReasons: sql`excluded.eligibility_reasons`,
          eligibilityCheckedAt: sql`excluded.eligibility_checked_at`,
          eligibilityExpiresAt: sql`excluded.eligibility_expires_at`,
        },
      });
  }
}

/**
 * Re-evaluate prospects in a workspace. `scope` selects which: specific ids, all prospects whose
 * email/domain matches a value (after a suppression change), cached decisions that have expired,
 * or everything. Returns the number re-evaluated.
 */
export async function refreshEligibility(
  db: AppDatabase,
  workspaceId: string,
  scope:
    | { kind: "ids"; ids: readonly string[] }
    | { kind: "value"; valueType: "email" | "domain"; value: string }
    | { kind: "expired" }
    | { kind: "all" },
  now = new Date(),
): Promise<number> {
  const base = eq(prospects.workspaceId, workspaceId);
  let where;
  if (scope.kind === "ids") {
    if (!scope.ids.length) return 0;
    where = and(base, inArray(prospects.id, [...scope.ids]));
  } else if (scope.kind === "value") {
    where = and(
      base,
      scope.valueType === "email"
        ? eq(prospects.emailNormalized, scope.value)
        : eq(prospects.emailDomain, scope.value),
    );
  } else if (scope.kind === "expired") {
    where = and(
      base,
      sql`exists (select 1 from app.prospect_outreach_state s where s.prospect_id = "app"."prospects"."id" and s.eligibility_expires_at is not null and s.eligibility_expires_at <= ${now.toISOString()}::timestamptz)`,
    );
  } else {
    where = base;
  }

  const policies = await loadPolicies(db, workspaceId);
  let total = 0;
  let lastId: string | null = null;
  // Keyset pagination over prospect ids keeps memory bounded for large workspaces.
  for (;;) {
    const page: EligibilitySubject[] = await db
      .select(subjectColumns)
      .from(prospects)
      .where(lastId ? and(where, sql`${prospects.id} > ${lastId}`) : where)
      .orderBy(prospects.id)
      .limit(1000);
    if (!page.length) break;
    const ctx = await loadSuppressionContext(
      db,
      workspaceId,
      page.map((p) => p.emailNormalized).filter((e): e is string => Boolean(e)),
      page.map((p) => p.emailDomain).filter((d): d is string => Boolean(d)),
    );
    await writeEligibility(
      db,
      workspaceId,
      page.map((p) => ({
        prospectId: p.id!,
        result: evaluateSubject(workspaceId, p, policies, ctx, now),
      })),
      now,
    );
    total += page.length;
    lastId = page[page.length - 1]!.id!;
    if (page.length < 1000) break;
  }
  return total;
}

/** Workspaces whose prospects match a value — used to fan out a global suppression change. */
export async function workspacesWithValue(
  db: AppDatabase,
  valueType: "email" | "domain",
  value: string,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ ws: prospects.workspaceId })
    .from(prospects)
    .where(
      valueType === "email"
        ? eq(prospects.emailNormalized, value)
        : eq(prospects.emailDomain, value),
    );
  return rows.map((r) => r.ws);
}

/** Lazily re-evaluate decisions that have aged out (e.g. verification turned STALE). */
export async function refreshExpiredEligibility(
  db: AppDatabase,
  workspaceId: string,
  now = new Date(),
) {
  const [{ n } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(prospectOutreachState)
    .where(
      and(
        eq(prospectOutreachState.workspaceId, workspaceId),
        lte(prospectOutreachState.eligibilityExpiresAt, now),
      ),
    );
  return n > 0 ? refreshEligibility(db, workspaceId, { kind: "expired" }, now) : 0;
}
