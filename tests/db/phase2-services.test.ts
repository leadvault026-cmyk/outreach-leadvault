import type { PGlite } from "@electric-sql/pglite";
import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { AppDatabase } from "@/db/rls";
import * as s from "@/db/schema";
import { suggestMapping } from "@/domain/imports/fields";
import { parseProspectFilters } from "@/domain/prospects/filters";
import { uuidv7 } from "@/lib/ids";
import {
  addMembers,
  createAudience,
  getAudience,
  removeMembers,
} from "@/services/audience-service";
import { refreshEligibility, refreshExpiredEligibility } from "@/services/eligibility-service";
import {
  categoryCounts,
  commitImport,
  createImport,
  ImportError,
  listImportRows,
  saveMapping,
  validateImport,
  type ImportSettingsInput,
  type TxRunner,
} from "@/services/import-service";
import { getProspectDetail, listProspects, selectProspectIds } from "@/services/prospect-query";
import {
  addGlobalSuppression,
  addWorkspaceSuppression,
  liftGlobalSuppression,
  liftWorkspaceSuppression,
  SuppressionError,
} from "@/services/suppression-service";
import { asUser, createAuthUser, createTestDatabase, pgErrorCode, type TestDb } from "./harness";

let db: TestDb;
let client: PGlite;
const sys = () => db as unknown as AppDatabase;

const U = {
  ownerA: uuidv7(),
  adminA: uuidv7(),
  operatorA: uuidv7(),
  viewerA: uuidv7(),
  ownerB: uuidv7(),
};
const WS_A = uuidv7();
const WS_B = uuidv7();
const NOW = new Date("2026-10-01T12:00:00Z");

const runAs =
  (userId: string): TxRunner =>
  (fn) =>
    asUser(db, userId, (tx) => fn(tx as unknown as AppDatabase));

const HEADER =
  "COMPANY NAME,WEBSITE,CONTACT NAME,CONTACT TITLE,EMAIL ADDRESS,PHONE NUMBER,ADDRESS,CITY,STATE,PROVIDER TYPE,QUALIFICATION BASIS,EVIDENCE URL,COUNTRY,VERIFICATION STATUS,VERIFIED AT";
const line = (o: Partial<Record<string, string>> = {}) => {
  const d = {
    company: "Alpha Family Medicine",
    website: "https://www.alpha.example",
    contact: "Jane Doe",
    title: "Practice Manager",
    email: "jane@alpha.example",
    phone: "+1 555 010 0001",
    address: "1 Main St",
    city: "Austin",
    state: "TX",
    type: "Family Medicine",
    basis: "Independent practice",
    evidence: "https://alpha.example/about",
    country: "US",
    status: "valid",
    verified: "2026-09-15",
    ...o,
  };
  return [
    d.company,
    d.website,
    d.contact,
    d.title,
    d.email,
    d.phone,
    d.address,
    d.city,
    d.state,
    d.type,
    d.basis,
    d.evidence,
    d.country,
    d.status,
    d.verified,
  ]
    .map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v))
    .join(",");
};
const csv = (...lines: string[]) => new TextEncoder().encode([HEADER, ...lines].join("\n") + "\n");

const SETTINGS: ImportSettingsInput = {
  sourceLabel: "Test batch",
  reference: "",
  defaultCountryCode: "",
  defaultBusinessType: "",
  verificationMode: "trust",
  verificationSourceLabel: "LeadVault research",
  onExisting: "update",
};

/** Full wizard run as a user; returns the import id and commit result. */
async function runImport(
  userId: string,
  workspaceId: string,
  bytes: Uint8Array,
  settings = SETTINGS,
) {
  const actor = { workspaceId, userId };
  const created = await runAs(userId)((tx) =>
    createImport(tx, actor, { name: "batch.csv", bytes }),
  );
  if (!created.ok) throw new Error(created.error.message);
  const headers = HEADER.split(",");
  await runAs(userId)((tx) =>
    saveMapping(tx, actor, created.importId, suggestMapping(headers).mapping, []),
  );
  const summary = await runAs(userId)((tx) =>
    validateImport(tx, actor, created.importId, settings, NOW),
  );
  const result = await commitImport(runAs(userId), actor, created.importId, NOW);
  return { importId: created.importId, previous: created.previous, summary, result };
}

async function eligibilityOf(email: string, ws = WS_A) {
  const [row] = await db
    .select({
      e: s.prospectOutreachState.eligibility,
      reasons: s.prospectOutreachState.eligibilityReasons,
    })
    .from(s.prospects)
    .innerJoin(s.prospectOutreachState, eq(s.prospectOutreachState.prospectId, s.prospects.id))
    .where(and(eq(s.prospects.workspaceId, ws), eq(s.prospects.emailNormalized, email)));
  return row;
}

beforeAll(async () => {
  ({ db, client } = await createTestDatabase());
  for (const [k, id] of Object.entries(U)) await createAuthUser(client, id, `${k}@test.example`, k);
  await db.insert(s.workspaces).values([
    { id: WS_A, name: "A", slug: "p2-a", defaultTimezone: "UTC" },
    { id: WS_B, name: "B", slug: "p2-b", defaultTimezone: "UTC" },
  ]);
  await db.insert(s.workspaceMembers).values([
    { workspaceId: WS_A, userId: U.ownerA, role: "OWNER" },
    { workspaceId: WS_A, userId: U.adminA, role: "ADMIN" },
    { workspaceId: WS_A, userId: U.operatorA, role: "OPERATOR" },
    { workspaceId: WS_A, userId: U.viewerA, role: "VIEWER" },
    { workspaceId: WS_B, userId: U.ownerB, role: "OWNER" },
  ]);
  // Test-only policy so that ELIGIBLE is reachable in workspace A. Workspace B has none.
  await db.insert(s.jurisdictionPolicies).values({
    scope: "workspace",
    workspaceId: WS_A,
    countryCode: "US",
    outreachStatus: "allowed",
  });
});

describe("CSV import lifecycle", () => {
  it("imports a LeadVault delivery file end-to-end with an outcome for every row", async () => {
    const bytes = csv(
      line(),
      line({
        company: "Beta Pediatrics",
        website: "beta.example",
        contact: "Sam Roe",
        email: "SAM@Beta.Example ",
      }),
      line({
        company: "Gamma Clinic",
        website: "gamma.example",
        contact: "Ann Lee",
        email: "ann@gamma",
      }),
      line({ company: "", email: "x@nocompany.example" }),
      line({
        company: "Delta Care",
        website: "delta.example",
        contact: "Bo Kim",
        email: "bo@gmail.com",
      }),
      line({
        company: "Echo Health",
        website: "echo.example",
        contact: "Cy Fox",
        email: "cy@echo.example",
        country: "",
      }),
      line({ email: "JANE@alpha.example" }),
      line({
        company: "Foxtrot Dental",
        website: "foxtrot.example",
        contact: "Di Ng",
        email: "di@foxtrot.example",
        status: "catch-all",
      }),
    );
    const { importId, summary, result } = await runImport(U.operatorA, WS_A, bytes);
    expect(summary).toMatchObject({ total: 8, create: 5, invalid: 2, duplicate: 1 });
    expect(result.status).toBe("completed_with_issues");

    const rows = await runAs(U.operatorA)((tx) =>
      listImportRows(tx, WS_A, importId, { phase: "result", page: 1, size: 50 }),
    );
    expect(rows.total).toBe(8);
    const byRow = new Map(rows.rows.map((r) => [r.rowNumber, r]));
    expect(rows.rows.every((r) => r.outcome !== "pending")).toBe(true);
    expect(byRow.get(1)).toMatchObject({ outcome: "create", eligibility: "ELIGIBLE" });
    expect(byRow.get(2)).toMatchObject({ outcome: "create", eligibility: "ELIGIBLE" });
    expect(byRow.get(3)?.outcome).toBe("invalid");
    expect(byRow.get(3)?.issues.map((i) => i.code)).toContain("INVALID_EMAIL");
    expect(byRow.get(4)?.issues.map((i) => i.code)).toContain("MISSING_REQUIRED_FIELD");
    expect(byRow.get(5)).toMatchObject({ outcome: "create", eligibility: "INELIGIBLE" });
    expect(byRow.get(5)?.eligibilityReasons).toContain("CONSUMER_EMAIL_NOT_ALLOWED");
    expect(byRow.get(6)).toMatchObject({ outcome: "create", eligibility: "NEEDS_REVIEW" });
    expect(byRow.get(6)?.eligibilityReasons).toContain("COUNTRY_UNKNOWN");
    expect(byRow.get(7)?.outcome).toBe("duplicate_in_file");
    expect(byRow.get(8)?.eligibilityReasons).toContain("EMAIL_RISKY");
    expect(byRow.get(1)?.prospectId).toBeTruthy();

    const counts = await runAs(U.operatorA)((tx) => categoryCounts(tx, WS_A, importId, "result"));
    expect(counts).toMatchObject({ ready: 2, review: 2, ineligible: 1, invalid: 2, duplicate: 1 });

    const [imp] = await db
      .select()
      .from(s.prospectImports)
      .where(eq(s.prospectImports.id, importId));
    expect(imp).toMatchObject({
      createdCount: 5,
      invalidCount: 2,
      duplicateCount: 1,
      status: "completed_with_issues",
    });
    expect(imp?.completedAt).toBeTruthy();

    // Normalized storage.
    const [beta] = await db
      .select()
      .from(s.prospects)
      .where(eq(s.prospects.emailNormalized, "sam@beta.example"));
    expect(beta).toMatchObject({
      websiteDomain: "beta.example",
      countryCode: "US",
      regionCode: "US-TX",
      emailVerificationStatus: "VERIFIED",
      firstImportId: importId,
    });
  });

  it("re-importing the same file is idempotent (no duplicates, rows 'unchanged')", async () => {
    const before = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(s.prospects)
      .where(eq(s.prospects.workspaceId, WS_A));
    const bytes = csv(
      line(),
      line({
        company: "Beta Pediatrics",
        website: "beta.example",
        contact: "Sam Roe",
        email: "sam@beta.example",
      }),
    );
    const again = await runImport(U.operatorA, WS_A, bytes);
    expect(again.summary).toMatchObject({ unchanged: 2, create: 0 });
    const twice = await runImport(U.operatorA, WS_A, bytes);
    expect(twice.previous?.id).toBe(again.importId); // same file detected
    expect(twice.summary).toMatchObject({ unchanged: 2, create: 0 });
    const after = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(s.prospects)
      .where(eq(s.prospects.workspaceId, WS_A));
    expect(after[0]?.n).toBe(before[0]?.n);
  });

  it("updates changed contact information but never erases with blanks", async () => {
    const { summary } = await runImport(
      U.operatorA,
      WS_A,
      csv(line({ title: "Operations Director", phone: "" })),
    );
    expect(summary.update).toBe(1);
    const [p] = await db
      .select()
      .from(s.prospects)
      .where(eq(s.prospects.emailNormalized, "jane@alpha.example"));
    expect(p).toMatchObject({ contactTitle: "Operations Director", phone: "+1 555 010 0001" });
  });

  it("can skip existing prospects instead of updating them", async () => {
    const { summary } = await runImport(U.operatorA, WS_A, csv(line({ title: "Owner" })), {
      ...SETTINGS,
      onExisting: "skip",
    });
    expect(summary).toMatchObject({ duplicate: 1, update: 0 });
    const [p] = await db
      .select()
      .from(s.prospects)
      .where(eq(s.prospects.emailNormalized, "jane@alpha.example"));
    expect(p?.contactTitle).toBe("Operations Director");
  });

  it("blank-email records match on company/contact/domain when re-imported", async () => {
    const bytes = csv(
      line({ company: "Hotel Clinic", website: "hotel.example", contact: "Ed Wu", email: "" }),
    );
    expect((await runImport(U.operatorA, WS_A, bytes)).summary.create).toBe(1);
    expect((await runImport(U.operatorA, WS_A, bytes)).summary).toMatchObject({
      create: 0,
      unchanged: 1,
    });
  });

  it("never merges across workspaces", async () => {
    const { summary } = await runImport(U.ownerB, WS_B, csv(line()));
    expect(summary.create).toBe(1);
    const rows = await db
      .select({ ws: s.prospects.workspaceId })
      .from(s.prospects)
      .where(eq(s.prospects.emailNormalized, "jane@alpha.example"));
    expect(rows.map((r) => r.ws).sort()).toEqual([WS_A, WS_B].sort());
    // Workspace B has no jurisdiction policy → held for review.
    expect((await eligibilityOf("jane@alpha.example", WS_B))?.e).toBe("NEEDS_REVIEW");
  });

  it("an import can only run once", async () => {
    const actor = { workspaceId: WS_A, userId: U.operatorA };
    const created = await runAs(U.operatorA)((tx) =>
      createImport(tx, actor, { name: "x.csv", bytes: csv(line({ email: "once@alpha.example" })) }),
    );
    if (!created.ok) throw new Error("upload failed");
    await runAs(U.operatorA)((tx) =>
      saveMapping(tx, actor, created.importId, suggestMapping(HEADER.split(",")).mapping, []),
    );
    await runAs(U.operatorA)((tx) => validateImport(tx, actor, created.importId, SETTINGS, NOW));
    await commitImport(runAs(U.operatorA), actor, created.importId, NOW);
    await expect(
      commitImport(runAs(U.operatorA), actor, created.importId, NOW),
    ).rejects.toBeInstanceOf(ImportError);
  });

  it("rejects malformed uploads with a clear error and stores nothing", async () => {
    const actor = { workspaceId: WS_A, userId: U.operatorA };
    const before = await db.select({ n: sql<number>`count(*)::int` }).from(s.prospectImports);
    const bad = await runAs(U.operatorA)((tx) =>
      createImport(tx, actor, { name: "bad.csv", bytes: new Uint8Array([0x43, 0xe9, 0x0a]) }),
    );
    expect(bad).toMatchObject({ ok: false, error: { code: "INVALID_ENCODING" } });
    const empty = await runAs(U.operatorA)((tx) =>
      createImport(tx, actor, { name: "empty.csv", bytes: new TextEncoder().encode("A,B\n") }),
    );
    expect(empty).toMatchObject({ ok: false, error: { code: "NO_DATA_ROWS" } });
    const after = await db.select({ n: sql<number>`count(*)::int` }).from(s.prospectImports);
    expect(after[0]?.n).toBe(before[0]?.n);
  });
});

describe("search, filters and pagination", () => {
  it("searches across fields and combines filters", async () => {
    const q = (p: Record<string, string>) =>
      runAs(U.viewerA)((tx) => listProspects(tx, WS_A, parseProspectFilters(p), NOW));
    expect((await q({ q: "pediatrics" })).rows.map((r) => r.companyName)).toEqual([
      "Beta Pediatrics",
    ]);
    expect((await q({ q: "sam beta" })).total).toBe(1);
    expect((await q({ q: "100%_" })).total).toBe(0); // LIKE metacharacters are escaped
    // Alpha, Beta and once@alpha (from the run-once test) are eligible.
    expect((await q({ eligibility: "ELIGIBLE" })).total).toBe(3);
    expect((await q({ country: "none" })).rows.map((r) => r.companyName)).toEqual(["Echo Health"]);
    expect((await q({ verification: "RISKY" })).rows.map((r) => r.companyName)).toEqual([
      "Foxtrot Dental",
    ]);
    expect((await q({ has: "phone", q: "hotel" })).total).toBe(1);
    const page1 = await q({ size: "25", sort: "company", dir: "asc" });
    expect(page1.rows[0]?.companyName).toBe("Alpha Family Medicine");
    expect(page1.total).toBeGreaterThanOrEqual(6);
  });

  it("paginates deterministically", async () => {
    const all = await runAs(U.viewerA)((tx) =>
      selectProspectIds(tx, WS_A, parseProspectFilters({})),
    );
    const pages: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const r = await runAs(U.viewerA)((tx) =>
        listProspects(
          tx,
          WS_A,
          parseProspectFilters({ size: "25", page: String(page), sort: "company" }),
          NOW,
        ),
      );
      pages.push(...r.rows.map((x) => x.id));
    }
    expect(new Set(pages).size).toBe(all.ids.length);
  });
});

describe("suppression and unsubscribes drive eligibility", () => {
  it("workspace suppression → SUPPRESSED immediately; lift restores it; history is kept", async () => {
    const actor = { workspaceId: WS_A, userId: U.operatorA };
    const added = await runAs(U.operatorA)((tx) =>
      addWorkspaceSuppression(tx, actor, {
        valueType: "email",
        value: "Jane@Alpha.Example",
        reason: "MANUAL_DO_NOT_CONTACT",
        note: "Asked by client",
      }),
    );
    expect(added.reevaluated).toBe(1);
    expect(await eligibilityOf("jane@alpha.example")).toMatchObject({
      e: "SUPPRESSED",
      reasons: expect.arrayContaining(["WORKSPACE_SUPPRESSION"]),
    });
    // Workspace B's copy is unaffected.
    expect((await eligibilityOf("jane@alpha.example", WS_B))?.e).toBe("NEEDS_REVIEW");
    await expect(
      runAs(U.operatorA)((tx) =>
        addWorkspaceSuppression(tx, actor, {
          valueType: "email",
          value: "jane@alpha.example",
          reason: "COMPLIANCE",
          note: "dupe check",
        }),
      ),
    ).rejects.toBeInstanceOf(SuppressionError);

    // OPERATOR cannot lift (RLS: ADMIN+); ADMIN can.
    await expect(
      runAs(U.operatorA)((tx) =>
        liftWorkspaceSuppression(tx, actor, added.id, "Client approved re-contact"),
      ),
    ).rejects.toBeInstanceOf(SuppressionError);
    await runAs(U.adminA)((tx) =>
      liftWorkspaceSuppression(
        tx,
        { workspaceId: WS_A, userId: U.adminA },
        added.id,
        "Client approved re-contact",
      ),
    );
    expect((await eligibilityOf("jane@alpha.example"))?.e).toBe("ELIGIBLE");
    const [hist] = await db.select().from(s.suppressions).where(eq(s.suppressions.id, added.id));
    expect(hist).toMatchObject({ liftReason: "Client approved re-contact", liftedBy: U.adminA });
  });

  it("domain suppression covers every address at the domain", async () => {
    await runAs(U.operatorA)((tx) =>
      addWorkspaceSuppression(
        tx,
        { workspaceId: WS_A, userId: U.operatorA },
        {
          valueType: "domain",
          value: "beta.example",
          reason: "MANUAL_DO_NOT_CONTACT",
          note: "Competitor",
        },
      ),
    );
    expect((await eligibilityOf("sam@beta.example"))?.e).toBe("SUPPRESSED");
  });

  it("global suppression affects every workspace and lifting it is privileged", async () => {
    const g = await addGlobalSuppression(
      sys(),
      { userId: U.ownerA },
      { valueType: "email", value: "jane@alpha.example", reason: "COMPLIANCE", note: "Legal hold" },
    );
    expect(g.reevaluated).toBe(2);
    expect((await eligibilityOf("jane@alpha.example"))?.reasons).toContain("GLOBAL_SUPPRESSION");
    expect((await eligibilityOf("jane@alpha.example", WS_B))?.e).toBe("SUPPRESSED");
    // A workspace OWNER cannot lift it through their session (RLS) …
    const rows = await runAs(U.ownerA)((tx) =>
      tx
        .update(s.suppressions)
        .set({ liftedAt: new Date(), liftReason: "attempt" })
        .where(eq(s.suppressions.id, g.id))
        .returning(),
    );
    expect(rows).toHaveLength(0);
    // … only the privileged path (platform admin verified by the server) can.
    await liftGlobalSuppression(sys(), { userId: U.ownerA }, g.id, "Legal hold released");
    expect((await eligibilityOf("jane@alpha.example"))?.e).toBe("ELIGIBLE");
  });

  it("an unsubscribe record makes the prospect SUPPRESSED (UNSUBSCRIBED)", async () => {
    const [supp] = await db
      .insert(s.suppressions)
      .values({
        scope: "workspace",
        workspaceId: WS_A,
        valueType: "email",
        valueNormalized: "di@foxtrot.example",
        reason: "UNSUBSCRIBE",
        source: "reply",
      })
      .returning();
    await db.insert(s.unsubscribes).values({
      workspaceId: WS_A,
      emailNormalized: "di@foxtrot.example",
      method: "reply",
      suppressionId: supp!.id,
    });
    await refreshEligibility(sys(), WS_A, {
      kind: "value",
      valueType: "email",
      value: "di@foxtrot.example",
    });
    expect(await eligibilityOf("di@foxtrot.example")).toMatchObject({
      e: "SUPPRESSED",
      reasons: expect.arrayContaining(["UNSUBSCRIBED"]),
    });
  });

  it("cached decisions expire and are re-evaluated (verification turns STALE)", async () => {
    const later = new Date(NOW.getTime() + 100 * 86_400_000);
    const n = await refreshExpiredEligibility(sys(), WS_A, later);
    expect(n).toBeGreaterThan(0);
    expect((await eligibilityOf("jane@alpha.example"))?.reasons).toContain("VERIFICATION_STALE");
    await refreshEligibility(sys(), WS_A, { kind: "all" }, NOW); // restore for later tests
  });

  it("prospect detail shows live eligibility and suppression history", async () => {
    const [p] = await db
      .select()
      .from(s.prospects)
      .where(
        and(
          eq(s.prospects.workspaceId, WS_A),
          eq(s.prospects.emailNormalized, "jane@alpha.example"),
        ),
      );
    const detail = await runAs(U.viewerA)((tx) => getProspectDetail(tx, WS_A, p!.id, NOW));
    expect(detail?.live.status).toBe("ELIGIBLE");
    expect(detail?.suppressionHistory.length).toBeGreaterThanOrEqual(2); // workspace (lifted) + global (lifted)
    expect(detail?.provenance.length).toBeGreaterThanOrEqual(1);
  });
});

describe("audiences", () => {
  it("adds only allowed prospects and reports everything excluded", async () => {
    const actor = { workspaceId: WS_A, userId: U.operatorA };
    const audienceId = await runAs(U.operatorA)((tx) =>
      createAudience(tx, actor, { name: "Texas clinics", description: "Test" }),
    );
    const all = await runAs(U.operatorA)((tx) =>
      selectProspectIds(tx, WS_A, parseProspectFilters({})),
    );
    const res = await runAs(U.operatorA)((tx) =>
      addMembers(tx, actor, audienceId, [...all.ids, uuidv7()], "eligible"),
    );
    expect(res.selected).toBe(all.ids.length + 1);
    expect(res.notFound).toBe(1);
    expect(res.added + Object.values(res.excluded).reduce((a, b) => a + b, 0)).toBe(all.ids.length);
    expect(res.excluded.SUPPRESSED).toBeGreaterThan(0);

    const again = await runAs(U.operatorA)((tx) =>
      addMembers(tx, actor, audienceId, all.ids, "eligible"),
    );
    expect(again).toMatchObject({ added: 0, alreadyMembers: res.added });

    const summary = await runAs(U.viewerA)((tx) => getAudience(tx, WS_A, audienceId));
    expect(summary?.counts).toMatchObject({ total: res.added, ELIGIBLE: res.added });

    const withReview = await runAs(U.operatorA)((tx) =>
      addMembers(tx, actor, audienceId, all.ids, "eligible_and_review"),
    );
    expect(withReview.added).toBe(res.excluded.NEEDS_REVIEW);

    const members = await runAs(U.viewerA)((tx) =>
      listProspects(tx, WS_A, parseProspectFilters({ audience: audienceId }), NOW),
    );
    expect(members.total).toBe(res.added + withReview.added);
    const removed = await runAs(U.operatorA)((tx) =>
      removeMembers(
        tx,
        actor,
        audienceId,
        members.rows.slice(0, 1).map((m) => m.id),
      ),
    );
    expect(removed).toBe(1);
  });

  it("rejects duplicate audience names in the same workspace only", async () => {
    await expect(
      runAs(U.operatorA)((tx) =>
        createAudience(tx, { workspaceId: WS_A, userId: U.operatorA }, { name: "texas CLINICS" }),
      ),
    ).rejects.toThrow(/already exists/);
    await runAs(U.ownerB)((tx) =>
      createAudience(tx, { workspaceId: WS_B, userId: U.ownerB }, { name: "Texas clinics" }),
    );
  });
});

describe("malicious cross-workspace access (Phase 2 tables)", () => {
  const attackerA = { workspaceId: WS_B, userId: U.operatorA }; // A's operator naming B's workspace

  it("cannot read B's prospects, imports, import rows or audiences even with B's ids", async () => {
    const [bProspect] = await db
      .select()
      .from(s.prospects)
      .where(eq(s.prospects.workspaceId, WS_B));
    const [bImport] = await db
      .select()
      .from(s.prospectImports)
      .where(eq(s.prospectImports.workspaceId, WS_B));
    const [bAudience] = await db
      .select()
      .from(s.audiences)
      .where(eq(s.audiences.workspaceId, WS_B));
    const result = await runAs(U.operatorA)(async (tx) => ({
      list: await listProspects(tx, WS_B, parseProspectFilters({}), NOW),
      detail: await getProspectDetail(tx, WS_B, bProspect!.id, NOW),
      rows: await listImportRows(tx, WS_B, bImport!.id, { phase: "result", page: 1, size: 10 }),
      imports: await tx
        .select()
        .from(s.prospectImports)
        .where(eq(s.prospectImports.id, bImport!.id)),
      audience: await getAudience(tx, WS_B, bAudience!.id),
    }));
    expect(result.list.total).toBe(0);
    expect(result.detail).toBeNull();
    expect(result.rows.total).toBe(0);
    expect(result.imports).toHaveLength(0);
    expect(result.audience).toBeNull();
  });

  it("cannot update or delete B's prospects", async () => {
    const [bProspect] = await db
      .select()
      .from(s.prospects)
      .where(eq(s.prospects.workspaceId, WS_B));
    const upd = await runAs(U.ownerA)((tx) =>
      tx
        .update(s.prospects)
        .set({ companyName: "x" })
        .where(eq(s.prospects.id, bProspect!.id))
        .returning(),
    );
    expect(upd).toHaveLength(0);
    expect(
      await pgErrorCode(
        runAs(U.ownerA)((tx) => tx.delete(s.prospects).where(eq(s.prospects.id, bProspect!.id))),
      ),
    ).toBe("42501");
  });

  it("cannot upload into, run, or change membership in B", async () => {
    expect(
      await pgErrorCode(
        runAs(U.operatorA)((tx) =>
          createImport(tx, attackerA, { name: "x.csv", bytes: csv(line()) }),
        ),
      ),
    ).toBe("42501");
    const [bImport] = await db
      .select()
      .from(s.prospectImports)
      .where(eq(s.prospectImports.workspaceId, WS_B));
    await db
      .update(s.prospectImports)
      .set({ status: "ready" })
      .where(eq(s.prospectImports.id, bImport!.id));
    await expect(
      commitImport(runAs(U.operatorA), attackerA, bImport!.id, NOW),
    ).rejects.toBeInstanceOf(ImportError);
    await db
      .update(s.prospectImports)
      .set({ status: "completed" })
      .where(eq(s.prospectImports.id, bImport!.id));

    const [bAudience] = await db
      .select()
      .from(s.audiences)
      .where(eq(s.audiences.workspaceId, WS_B));
    const [aProspect] = await db
      .select()
      .from(s.prospects)
      .where(eq(s.prospects.workspaceId, WS_A));
    await expect(
      runAs(U.operatorA)((tx) => addMembers(tx, attackerA, bAudience!.id, [aProspect!.id], "all")),
    ).rejects.toThrow(/not found/i);
    expect(
      await pgErrorCode(
        runAs(U.operatorA)((tx) =>
          tx.insert(s.audienceMembers).values({
            audienceId: bAudience!.id,
            prospectId: aProspect!.id,
            workspaceId: WS_B,
            addedVia: "manual",
          }),
        ),
      ),
    ).toBe("42501");
  });

  it("cannot create or lift B's suppressions", async () => {
    expect(
      await pgErrorCode(
        runAs(U.operatorA)((tx) =>
          addWorkspaceSuppression(tx, attackerA, {
            valueType: "email",
            value: "z@b.example",
            reason: "COMPLIANCE",
            note: "attack",
          }),
        ),
      ),
    ).toBe("42501");
    const [bSupp] = await db
      .insert(s.suppressions)
      .values({
        scope: "workspace",
        workspaceId: WS_B,
        valueType: "email",
        valueNormalized: "keep@b.example",
        reason: "COMPLIANCE",
        source: "manual",
      })
      .returning();
    await expect(
      runAs(U.adminA)((tx) =>
        liftWorkspaceSuppression(
          tx,
          { workspaceId: WS_B, userId: U.adminA },
          bSupp!.id,
          "attempted lift",
        ),
      ),
    ).rejects.toBeInstanceOf(SuppressionError);
    const [still] = await db.select().from(s.suppressions).where(eq(s.suppressions.id, bSupp!.id));
    expect(still?.liftedAt).toBeNull();
  });
});

describe("viewer authorization", () => {
  it("VIEWER cannot import, create audiences or suppress", async () => {
    const actor = { workspaceId: WS_A, userId: U.viewerA };
    expect(
      await pgErrorCode(
        runAs(U.viewerA)((tx) => createImport(tx, actor, { name: "v.csv", bytes: csv(line()) })),
      ),
    ).toBe("42501");
    expect(
      await pgErrorCode(
        runAs(U.viewerA)((tx) => createAudience(tx, actor, { name: "Viewer audience" })),
      ),
    ).toBe("42501");
    expect(
      await pgErrorCode(
        runAs(U.viewerA)((tx) =>
          addWorkspaceSuppression(tx, actor, {
            valueType: "email",
            value: "v@a.example",
            reason: "COMPLIANCE",
            note: "viewer",
          }),
        ),
      ),
    ).toBe("42501");
  });
});
