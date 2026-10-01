/**
 * Demo/development seed — LOCAL ONLY.
 *
 * Creates clearly fictional data for two demo workspaces so the dashboard and workspace-isolation
 * behaviour can be exercised. All people, companies and domains are invented; email domains use
 * the reserved `.test` / `.example` TLDs (RFC 2606), so nothing here can reach a real inbox.
 * No email is sent. Refuses to run against anything other than a local database.
 */
import { existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as s from "../src/db/schema";
import { uuidv7 } from "../src/lib/ids";
import { refreshEligibility } from "../src/services/eligibility-service";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const DAY = 86_400_000;

// ───────────────────────────── Safety ─────────────────────────────
function assertLocal() {
  const dbUrl = process.env.DATABASE_URL ?? "";
  const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const isLocal = (u: string) =>
    /^(postgres(ql)?|https?):\/\/([^@/]*@)?(127\.0\.0\.1|localhost)(:\d+)?/.test(u);
  if (process.env.APP_ENV !== "local" || !isLocal(dbUrl) || !isLocal(apiUrl)) {
    console.error(
      "Refusing to seed: APP_ENV must be 'local' and both database and Supabase URLs must be localhost.",
    );
    process.exit(1);
  }
  if (!process.env.SUPABASE_SECRET_KEY) {
    console.error("SUPABASE_SECRET_KEY is required (local stack: `npx supabase status`).");
    process.exit(1);
  }
  const pw = process.env.SEED_DEMO_PASSWORD ?? "";
  if (pw.length < 12 || !/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw)) {
    console.error(
      "SEED_DEMO_PASSWORD must be ≥12 chars with upper, lower and a digit (set it in .env.local).",
    );
    process.exit(1);
  }
}

// Deterministic PRNG so the demo looks the same on every reset.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261001);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

// ───────────────────────────── Fictional vocabulary ─────────────────────────────
const FIRST = [
  "Avery",
  "Blake",
  "Cameron",
  "Dana",
  "Elliot",
  "Frankie",
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
  "Quarry",
  "Rendell",
  "Stroud",
  "Thorne",
];
const COMPANY_A = [
  "Bluebonnet",
  "Lone Oak",
  "Pecan Grove",
  "Cedar Ridge",
  "Riverbend",
  "Prairie View",
  "Live Oak",
  "Mesquite",
  "Brazos",
  "Hill Country",
  "Peachtree",
  "Magnolia",
  "Sweetgum",
  "Red Clay",
  "Chattahoochee",
];
const COMPANY_B = [
  "Family Medicine",
  "Pediatrics",
  "Orthopedic Group",
  "Dermatology",
  "Physical Therapy",
  "Urgent Care",
  "Cardiology Associates",
  "Women's Health",
  "Sports Medicine",
  "Allergy Clinic",
];
const TITLES = [
  "Practice Manager",
  "Office Manager",
  "Medical Director",
  "Operations Director",
  "Clinic Administrator",
  "Owner",
];
const TX_CITIES = ["Austin", "Houston", "San Antonio", "Dallas", "Fort Worth", "Waco"];
const GA_CITIES = ["Atlanta", "Savannah", "Augusta", "Macon", "Athens"];
const VERIFICATION = ["valid", "valid", "valid", "valid", "catch-all", "unknown", "valid"];

function slugify(v: string) {
  return v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ───────────────────────────── Main ─────────────────────────────
async function main() {
  assertLocal();

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  const db = drizzle(sql, { schema: s });
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );

  const existing = await db
    .select({ id: s.workspaces.id })
    .from(s.workspaces)
    .where(eq(s.workspaces.slug, "northwind-demo"));
  if (existing.length > 0) {
    console.log("Demo data already present. Run `npm run db:reset` for a clean database.");
    await sql.end();
    return;
  }

  // Users (auth.users via the Admin API; profiles are created by the DB trigger).
  const password = process.env.SEED_DEMO_PASSWORD!;
  const people = [
    { key: "owner", email: "owner@leadvault-demo.test", name: "Morgan Ellis" },
    { key: "admin", email: "admin@leadvault-demo.test", name: "Riley Chen" },
    { key: "operator", email: "operator@leadvault-demo.test", name: "Sam Patel" },
    { key: "viewer", email: "viewer@leadvault-demo.test", name: "Jordan Brooks" },
    { key: "isolated", email: "isolated@leadvault-demo.test", name: "Casey Nguyen" },
  ] as const;
  const userIds: Record<string, string> = {};
  const { data: listed } = await admin.auth.admin.listUsers({ perPage: 200 });
  for (const p of people) {
    const found = listed?.users.find((u) => u.email === p.email);
    if (found) {
      userIds[p.key] = found.id;
      continue;
    }
    const { data, error } = await admin.auth.admin.createUser({
      email: p.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: p.name },
    });
    if (error || !data.user)
      throw new Error(`Could not create demo user ${p.email}: ${error?.message}`);
    userIds[p.key] = data.user.id;
  }
  await db
    .update(s.profiles)
    .set({ isPlatformAdmin: true })
    .where(eq(s.profiles.userId, userIds.owner!));

  const now = Date.now();

  await db.transaction(async (tx) => {
    // ── Workspaces & membership ──
    const wsA = uuidv7();
    const wsB = uuidv7();
    await tx.insert(s.workspaces).values([
      {
        id: wsA,
        name: "Northwind Clinics (Demo)",
        slug: "northwind-demo",
        kind: "client",
        defaultTimezone: "America/Chicago",
        senderCountryCode: "US",
        compliancePostalAddress:
          "Northwind Clinics (demo), 100 Example Avenue, Austin, TX 78701, USA — fictional",
        isDemo: true,
        createdBy: userIds.owner,
      },
      {
        id: wsB,
        name: "Harbor Dental Group (Demo)",
        slug: "harbor-demo",
        kind: "client",
        defaultTimezone: "Europe/London",
        senderCountryCode: "GB",
        compliancePostalAddress:
          "Harbor Dental Group (demo), 1 Example Quay, Bristol BS1 0AA, UK — fictional",
        isDemo: true,
        createdBy: userIds.owner,
      },
    ]);
    await tx.insert(s.workspaceMembers).values([
      { workspaceId: wsA, userId: userIds.owner!, role: "OWNER" },
      { workspaceId: wsA, userId: userIds.admin!, role: "ADMIN", invitedBy: userIds.owner },
      { workspaceId: wsA, userId: userIds.operator!, role: "OPERATOR", invitedBy: userIds.owner },
      { workspaceId: wsA, userId: userIds.viewer!, role: "VIEWER", invitedBy: userIds.owner },
      { workspaceId: wsB, userId: userIds.owner!, role: "OWNER" },
      { workspaceId: wsB, userId: userIds.isolated!, role: "OWNER", invitedBy: userIds.owner },
    ]);

    // ── Infrastructure (no real provider; placeholder bytes are not credentials) ──
    async function infra(
      ws: string,
      domain: string,
      boxes: Array<{
        local: string;
        name: string;
        status: "CONNECTED" | "NEEDS_ATTENTION";
        reason?: string;
      }>,
    ) {
      const connId = uuidv7();
      await tx.insert(s.providerConnections).values({
        id: connId,
        workspaceId: ws,
        provider: "smtp_imap",
        accountEmail: `ops@${domain}`,
        status: "active",
        encryptedCredentials: Buffer.from("DEMO-PLACEHOLDER-NO-CREDENTIALS"),
        credentialsKeyVersion: 0,
        metadata: { demo: true },
      });
      const out: Array<{ id: string; email: string; identityId: string; name: string }> = [];
      for (const b of boxes) {
        const id = uuidv7();
        const email = `${b.local}@${domain}`;
        await tx.insert(s.mailboxes).values({
          id,
          workspaceId: ws,
          providerConnectionId: connId,
          emailAddress: email,
          displayName: b.name,
          status: b.status,
          statusReason: b.reason ?? null,
          dailySendLimit: 50,
          // Short spacing so the fake-transport demo progresses quickly (real mailboxes: 90s+).
          minSecondsBetweenSends: 5,
          timezone: "America/Chicago",
          infraVendor: "demo",
          warmupStatus: "ready",
          warmupStartedAt: new Date(now - 40 * DAY),
        });
        const identityId = uuidv7();
        await tx.insert(s.sendingIdentities).values({
          id: identityId,
          workspaceId: ws,
          mailboxId: id,
          fromName: b.name,
          fromEmail: email,
          isDefault: true,
        });
        out.push({ id, email, identityId, name: b.name });
      }
      return out;
    }
    await infra(wsA, "northwind-outreach.example", [
      { local: "alex", name: "Alex Romero", status: "CONNECTED" },
      { local: "taylor", name: "Taylor Webb", status: "CONNECTED" },
      {
        local: "jamie",
        name: "Jamie Hart",
        status: "NEEDS_ATTENTION",
        reason: "Hard-bounce rate above 2% — auto-paused (demo)",
      },
    ]);
    await infra(wsB, "harbor-outreach.example", [
      { local: "lee", name: "Lee Morgan", status: "CONNECTED" },
    ]);

    // ── Prospects (research truth) + outreach state ──
    async function makeProspects(ws: string, count: number, region: "TX" | "GA" | "GB") {
      const rows: Array<{
        id: string;
        email: string;
        first: string;
        last: string;
        company: string;
      }> = [];
      const used = new Set<string>();
      for (let i = 0; i < count; i++) {
        let company = "";
        do company = `${pick(COMPANY_A)} ${pick(COMPANY_B)}`;
        while (used.has(company));
        used.add(company);
        const first = pick(FIRST);
        const last = pick(LAST);
        const domain = `${slugify(company)}.example`;
        const email = `${first.toLowerCase()}.${last.toLowerCase()}@${domain}`;
        const id = uuidv7();
        const label = pick(VERIFICATION);
        const status = label === "valid" ? "VERIFIED" : label === "catch-all" ? "RISKY" : "UNKNOWN";
        const isUs = region !== "GB";
        await tx.insert(s.prospects).values({
          id,
          workspaceId: ws,
          companyName: company,
          website: `https://www.${domain}`,
          websiteDomain: domain,
          contactName: `${first} ${last}`,
          firstName: first,
          lastName: last,
          contactTitle: pick(TITLES),
          email,
          emailNormalized: email,
          emailDomain: domain,
          emailVerificationStatus: status,
          emailVerifiedAt: status === "UNKNOWN" ? null : new Date(now - int(5, 60) * DAY),
          emailVerificationSource: status === "UNKNOWN" ? null : "research_import",
          emailVerificationDetail: label,
          phone: isUs
            ? `+1-555-01${String(int(0, 99)).padStart(2, "0")}`
            : `+44 20 7946 0${int(100, 999)}`,
          city: region === "TX" ? pick(TX_CITIES) : region === "GA" ? pick(GA_CITIES) : "Bristol",
          state: isUs ? region : null,
          countryCode: isUs ? "US" : "GB",
          regionCode: isUs ? `US-${region}` : null,
          businessType: company.split(" ").slice(-2).join(" "),
          qualificationBasis: "Independent practice with 3–20 providers (demo criterion)",
          evidenceUrl: `https://www.${domain}/about`,
          researchSourceRef: `DEMO-${region}-${1000 + i}`,
          researchApprovedAt: new Date(now - 30 * DAY),
        });
        // Eligibility is computed after seeding by the single engine (refreshEligibility).
        rows.push({ id, email, first, last, company });
      }
      return rows;
    }
    const prospectsTx = await makeProspects(wsA, 34, "TX");
    const prospectsGa = await makeProspects(wsA, 22, "GA");
    const prospectsB = await makeProspects(wsB, 8, "GB");

    // ── Audiences ──
    const audTx = uuidv7();
    const audGa = uuidv7();
    await tx.insert(s.audiences).values([
      {
        id: audTx,
        workspaceId: wsA,
        name: "Texas Medical Providers",
        description: "Independent practices across Texas (demo)",
        createdBy: userIds.operator,
      },
      {
        id: audGa,
        workspaceId: wsA,
        name: "Georgia Healthcare Prospects",
        description: "Georgia clinics (demo)",
        createdBy: userIds.operator,
      },
    ]);
    await tx.insert(s.audienceMembers).values([
      ...prospectsTx.map((p) => ({
        audienceId: audTx,
        prospectId: p.id,
        workspaceId: wsA,
        addedVia: "manual" as const,
        addedBy: userIds.operator,
      })),
      ...prospectsGa.map((p) => ({
        audienceId: audGa,
        prospectId: p.id,
        workspaceId: wsA,
        addedVia: "manual" as const,
        addedBy: userIds.operator,
      })),
    ]);

    // ── Templates for a 3-step sequence (fictional copy) ──
    await tx.insert(s.templates).values([
      {
        workspaceId: wsA,
        name: "1 · Introduction",
        subject: "Quick question for {{company_name}}",
        body: `Hi {{first_name|there}},

I work with independent practices like {{company_name}} in {{city|your area}} on front-desk scheduling. Would a short call next week be useful?

Best,
{{sender_name}}`,
        variablesUsed: ["first_name", "company_name", "city", "sender_name"],
        createdBy: userIds.operator,
      },
      {
        workspaceId: wsA,
        name: "2 · Follow-up",
        subject: "Following up",
        body: `Hi {{first_name|there}},

Just bringing this back to the top of your inbox. Happy to send a one-page overview instead of a call.

{{sender_name}}`,
        variablesUsed: ["first_name", "sender_name"],
        createdBy: userIds.operator,
      },
      {
        workspaceId: wsA,
        name: "3 · Final note",
        subject: "Closing the loop",
        body: `Hi {{first_name|there}},

I won't keep following up. If scheduling ever becomes a priority for {{company_name}}, just reply to this email.

{{sender_name}}`,
        variablesUsed: ["first_name", "company_name", "sender_name"],
        createdBy: userIds.operator,
      },
    ]);
    // No campaign history is fabricated: campaigns, sends, replies and bounces in the demo are
    // produced by the real pipeline (fake email transport) when the owner runs the walkthrough.
    await tx.insert(s.suppressions).values({
      scope: "workspace",
      workspaceId: wsB,
      valueType: "domain",
      valueNormalized: "do-not-contact.example",
      reason: "MANUAL_DO_NOT_CONTACT",
      source: "manual",
      note: "Demo workspace-scoped suppression",
      createdBy: userIds.isolated,
    });
    void prospectsB;

    // ── Phase 2 demo compliance data ──
    // DEMO ONLY: a workspace-level "allowed" policy for Texas so the eligible path can be shown on
    // fictional data. It is NOT a legal approval of any jurisdiction; Georgia (US-GA) and every
    // other place stays unconfigured and therefore resolves to REVIEW.
    await tx.insert(s.jurisdictionPolicies).values({
      scope: "workspace",
      workspaceId: wsA,
      countryCode: "US",
      regionCode: "US-TX",
      outreachStatus: "allowed",
      notes:
        "DEMO ONLY — fictional local data. Not a legal approval. Real policies are an owner decision.",
      updatedBy: userIds.owner,
    });
    // An unsubscribe (manual record; no public endpoint exists yet) with its suppression.
    const unsubscribed = prospectsTx[2]!;
    const [unsubSup] = await tx
      .insert(s.suppressions)
      .values({
        scope: "workspace",
        workspaceId: wsA,
        valueType: "email",
        valueNormalized: unsubscribed.email,
        reason: "UNSUBSCRIBE",
        source: "manual",
        note: "Demo: asked to be removed (recorded manually)",
        createdBy: userIds.operator,
      })
      .returning({ id: s.suppressions.id });
    await tx.insert(s.unsubscribes).values({
      workspaceId: wsA,
      emailNormalized: unsubscribed.email,
      method: "manual",
      suppressionId: unsubSup!.id,
      occurredAt: new Date(now - 3 * DAY),
    });
    // A workspace domain suppression covering one Georgia practice.
    await tx.insert(s.suppressions).values({
      scope: "workspace",
      workspaceId: wsA,
      valueType: "domain",
      valueNormalized: prospectsGa[0]!.email.split("@")[1]!,
      reason: "MANUAL_DO_NOT_CONTACT",
      source: "manual",
      note: "Demo: practice asked not to be contacted",
      createdBy: userIds.admin,
    });
    // A lifted suppression, to show that history is kept.
    await tx.insert(s.suppressions).values({
      scope: "workspace",
      workspaceId: wsA,
      valueType: "email",
      valueNormalized: prospectsTx[3]!.email,
      reason: "MANUAL_DO_NOT_CONTACT",
      source: "manual",
      note: "Demo: added by mistake",
      createdBy: userIds.operator,
      createdAt: new Date(now - 10 * DAY),
      liftedAt: new Date(now - 9 * DAY),
      liftedBy: userIds.admin,
      liftReason: "Demo: added to the wrong record, confirmed with the client.",
    });
  });

  // Every demo prospect gets its decision from the authoritative eligibility engine.
  const demo = await db
    .select({ id: s.workspaces.id })
    .from(s.workspaces)
    .where(eq(s.workspaces.isDemo, true));
  for (const w of demo) await refreshEligibility(db, w.id, { kind: "all" });

  console.log("Demo data seeded (fictional, local only).");
  console.log("Demo accounts (password = SEED_DEMO_PASSWORD from .env.local):");
  for (const p of people) console.log(`  ${p.email}`);
  await sql.end();
}

main().catch((error) => {
  console.error("Seed failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
