/**
 * Synthetic scale data — LOCAL ONLY.
 *
 * Creates a separate demo workspace ("scale-demo") holding a large number of entirely fictional
 * prospects (default 12,000) so list, search, filter, sort, audience and eligibility performance
 * can be measured (see scripts/perf-prospects.ts). Every company, person and phone number is
 * invented; every email domain uses the reserved `.example` TLD (RFC 2606). No email is sent.
 *
 *   npm run db:seed:synthetic            # 12,000 prospects
 *   npm run db:seed:synthetic -- 20000   # custom count (max 100,000)
 *
 * Re-running removes and recreates only the scale-demo workspace's prospects and audiences.
 */
import { existsSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { AppDatabase } from "../src/db/rls";
import * as s from "../src/db/schema";
import { uuidv7 } from "../src/lib/ids";
import { refreshEligibility } from "../src/services/eligibility-service";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const SLUG = "scale-demo";
const DAY = 86_400_000;

function assertLocal() {
  const dbUrl = process.env.DATABASE_URL ?? "";
  const isLocal = /^postgres(ql)?:\/\/([^@/]*@)?(127\.0\.0\.1|localhost)(:\d+)?/.test(dbUrl);
  if (process.env.APP_ENV !== "local" || !isLocal) {
    console.error("Refusing to run: APP_ENV must be 'local' and DATABASE_URL must be localhost.");
    process.exit(1);
  }
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(424242);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
const chance = (p: number) => rand() < p;

const FIRST = [
  "Avery",
  "Blake",
  "Cameron",
  "Dana",
  "Elliot",
  "Harper",
  "Jules",
  "Kendall",
  "Logan",
  "Marley",
  "Noel",
  "Parker",
  "Quinn",
  "Reese",
  "Rowan",
  "Sage",
  "Skyler",
  "Tatum",
  "Wren",
  "Emerson",
];
const LAST = [
  "Abbott",
  "Barrow",
  "Calder",
  "Dunmore",
  "Ellery",
  "Fairley",
  "Garrick",
  "Hollis",
  "Ivers",
  "Jessop",
  "Kingsley",
  "Lowell",
  "Marlow",
  "Nesbit",
  "Orwin",
  "Pembury",
  "Rendell",
  "Stroud",
  "Thorne",
  "Wexley",
];
const PREFIX = [
  "Bluebonnet",
  "Lone Oak",
  "Pecan Grove",
  "Cedar Ridge",
  "Riverbend",
  "Prairie View",
  "Harbor Point",
  "Maple Hill",
  "Silver Lake",
  "Granite Peak",
  "Willow Creek",
  "Summit",
  "Brookside",
  "Oakmont",
  "Sunrise",
  "Northgate",
  "Westfield",
  "Elm Street",
  "Kingsway",
  "Meadowbrook",
];
const TYPES = [
  "Family Medicine",
  "Pediatrics",
  "Dermatology",
  "Physical Therapy",
  "Urgent Care",
  "Dental Practice",
  "Orthodontics",
  "Chiropractic",
  "Optometry",
  "Podiatry",
  "Audiology",
  "Allergy",
  "Sleep Medicine",
  "Home Health",
  "Veterinary Clinic",
];
const TITLES = [
  "Practice Manager",
  "Office Manager",
  "Owner",
  "Medical Director",
  "Clinic Director",
  "Operations Lead",
  "Administrator",
];
const PLACES: Array<{
  country: string | null;
  region: string | null;
  state: string | null;
  cities: string[];
  w: number;
}> = [
  {
    country: "US",
    region: "US-TX",
    state: "TX",
    cities: ["Austin", "Dallas", "Houston", "San Antonio", "Waco"],
    w: 30,
  },
  { country: "US", region: "US-GA", state: "GA", cities: ["Atlanta", "Savannah", "Macon"], w: 12 },
  {
    country: "US",
    region: "US-CA",
    state: "CA",
    cities: ["Fresno", "Sacramento", "San Diego"],
    w: 12,
  },
  { country: "US", region: "US-NY", state: "NY", cities: ["Albany", "Buffalo", "Rochester"], w: 8 },
  { country: "US", region: "US-FL", state: "FL", cities: ["Tampa", "Orlando", "Miami"], w: 8 },
  {
    country: "GB",
    region: null,
    state: "Berkshire",
    cities: ["Reading", "Bristol", "Leeds"],
    w: 10,
  },
  { country: "CA", region: "CA-ON", state: "ON", cities: ["Toronto", "Ottawa"], w: 6 },
  { country: "AU", region: null, state: "NSW", cities: ["Sydney", "Newcastle"], w: 5 },
  { country: "DE", region: null, state: null, cities: ["Berlin", "Hamburg"], w: 4 },
  { country: null, region: null, state: null, cities: ["Springfield"], w: 5 },
];
const PLACE_TOTAL = PLACES.reduce((a, p) => a + p.w, 0);
function place() {
  let r = rand() * PLACE_TOTAL;
  for (const p of PLACES) if ((r -= p.w) < 0) return p;
  return PLACES[0]!;
}

async function main() {
  assertLocal();
  const count = Math.min(100_000, Math.max(1, Number(process.argv[2] ?? 12_000) || 12_000));
  const client = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  const db = drizzle(client, { schema: s });

  const [owner] = await db
    .select({ id: s.profiles.userId })
    .from(s.profiles)
    .where(eq(s.profiles.email, "owner@leadvault-demo.test"));
  if (!owner) throw new Error("Run `npm run db:seed` first (the demo owner account is needed).");

  let [ws] = await db.select().from(s.workspaces).where(eq(s.workspaces.slug, SLUG));
  if (!ws) {
    [ws] = await db
      .insert(s.workspaces)
      .values({
        name: "Scale Test (Synthetic Demo)",
        slug: SLUG,
        kind: "client",
        defaultTimezone: "UTC",
        isDemo: true,
        createdBy: owner.id,
      })
      .returning();
    await db
      .insert(s.workspaceMembers)
      .values({ workspaceId: ws!.id, userId: owner.id, role: "OWNER" });
    // DEMO ONLY, mirroring the main seed: not a legal approval of any jurisdiction.
    await db.insert(s.jurisdictionPolicies).values({
      scope: "workspace",
      workspaceId: ws!.id,
      countryCode: "US",
      regionCode: "US-TX",
      outreachStatus: "allowed",
      notes: "DEMO ONLY — synthetic local data. Not a legal approval.",
      updatedBy: owner.id,
    });
  }
  const wsId = ws!.id;

  // Clear previous synthetic rows for this workspace only.
  await db.delete(s.audienceMembers).where(eq(s.audienceMembers.workspaceId, wsId));
  await db.delete(s.audiences).where(eq(s.audiences.workspaceId, wsId));
  await db.delete(s.prospectOutreachState).where(eq(s.prospectOutreachState.workspaceId, wsId));
  await db.delete(s.prospects).where(eq(s.prospects.workspaceId, wsId));

  const now = Date.now();
  const t0 = performance.now();
  const ids: string[] = [];
  for (let start = 0; start < count; start += 1000) {
    const batch = [];
    for (let i = start; i < Math.min(count, start + 1000); i++) {
      const p = place();
      const type = pick(TYPES);
      const company = `${pick(PREFIX)} ${type} ${i + 1}`;
      const domain = `synthetic-${(i + 1).toString(36)}.example`;
      const first = pick(FIRST);
      const last = pick(LAST);
      const noEmail = chance(0.04);
      const role = chance(0.05);
      const otherDomain = chance(0.04);
      const local = role ? "info" : `${first}.${last}`.toLowerCase();
      const email = noEmail ? null : `${local}@${otherDomain ? `mail-${domain}` : domain}`;
      const v = rand();
      const status = v < 0.6 ? "VERIFIED" : v < 0.72 ? "RISKY" : v < 0.77 ? "INVALID" : "UNKNOWN";
      const ageDays = chance(0.1) ? 100 + Math.floor(rand() * 200) : Math.floor(rand() * 80);
      const id = uuidv7();
      ids.push(id);
      batch.push({
        id,
        workspaceId: wsId,
        companyName: company,
        website: `https://www.${domain}`,
        websiteDomain: domain,
        contactName: chance(0.06) ? null : `${first} ${last}`,
        firstName: first,
        lastName: last,
        contactTitle: chance(0.1) ? null : pick(TITLES),
        email,
        emailNormalized: email,
        emailDomain: email ? email.split("@")[1]! : null,
        emailVerificationStatus: email ? status : "UNKNOWN",
        emailVerifiedAt: email && status !== "UNKNOWN" ? new Date(now - ageDays * DAY) : null,
        emailVerificationSource: email && status !== "UNKNOWN" ? "synthetic" : null,
        phone: chance(0.15) ? null : `+1-555-01${String(i % 100).padStart(2, "0")}`,
        city: pick(p.cities),
        state: p.state,
        countryCode: p.country,
        regionCode: p.region,
        businessType: type,
        qualificationBasis: "Synthetic record for performance testing",
        evidenceUrl: chance(0.3) ? null : `https://www.${domain}/about`,
        researchSourceRef: `SYN-${i + 1}`,
      } satisfies typeof s.prospects.$inferInsert);
    }
    await db.insert(s.prospects).values(batch);
  }
  const t1 = performance.now();

  // A few suppressions so every eligibility state is represented.
  await db
    .delete(s.suppressions)
    .where(and(eq(s.suppressions.workspaceId, wsId), eq(s.suppressions.source, "manual")));
  await db.insert(s.suppressions).values(
    Array.from({ length: 25 }, (_, k) => ({
      scope: "workspace" as const,
      workspaceId: wsId,
      valueType: "domain" as const,
      valueNormalized: `synthetic-${(k * 37 + 1).toString(36)}.example`,
      reason: "MANUAL_DO_NOT_CONTACT" as const,
      source: "manual" as const,
      note: "Synthetic suppression",
      createdBy: owner.id,
    })),
  );

  const evaluated = await refreshEligibility(db as unknown as AppDatabase, wsId, { kind: "all" });
  const t2 = performance.now();

  const [aud] = await db
    .insert(s.audiences)
    .values({ workspaceId: wsId, name: "Synthetic — first 5,000", createdBy: owner.id })
    .returning({ id: s.audiences.id });
  const members = ids.slice(0, 5000);
  for (let i = 0; i < members.length; i += 1000) {
    await db.insert(s.audienceMembers).values(
      members.slice(i, i + 1000).map((prospectId) => ({
        audienceId: aud!.id,
        prospectId,
        workspaceId: wsId,
        addedVia: "manual" as const,
        addedBy: owner.id,
      })),
    );
  }
  await client`analyze app.prospects, app.prospect_outreach_state, app.audience_members`;

  console.log(`Synthetic workspace "${SLUG}": ${count.toLocaleString()} fictional prospects.`);
  console.log(`  insert:      ${((t1 - t0) / 1000).toFixed(1)} s`);
  console.log(`  eligibility: ${((t2 - t1) / 1000).toFixed(1)} s (${JSON.stringify(evaluated)})`);
  console.log(`  audience:    5,000 members`);
  console.log("Sign in as owner@leadvault-demo.test and open /w/scale-demo/prospects.");
  await client.end();
}

main().catch((e) => {
  console.error("Synthetic seed failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
