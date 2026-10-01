import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { AppDatabase } from "@/db/rls";
import * as s from "@/db/schema";
import { suggestMapping } from "@/domain/imports/fields";
import { uuidv7 } from "@/lib/ids";
import {
  commitImport,
  createImport,
  listImportRows,
  rowCategory,
  saveMapping,
  validateImport,
  type TxRunner,
} from "@/services/import-service";
import { asUser, createAuthUser, createTestDatabase, type TestDb } from "./harness";

/**
 * The owner's testing guide promises specific results for samples/leadvault-sample-prospects.csv.
 * This test imports the real file under the same conditions as the demo workspace (a demo-only
 * Texas policy, nothing else configured) and checks every promised outcome.
 */
let db: TestDb;
const OWNER = uuidv7();
const WS = uuidv7();
const NOW = new Date("2026-10-01T12:00:00Z");
const runAs: TxRunner = (fn) => asUser(db, OWNER, (tx) => fn(tx as unknown as AppDatabase));

beforeAll(async () => {
  let client;
  ({ db, client } = await createTestDatabase());
  await createAuthUser(client, OWNER, "owner@test.example", "Owner");
  await db
    .insert(s.workspaces)
    .values({ id: WS, name: "Sample", slug: "sample", defaultTimezone: "UTC" });
  await db.insert(s.workspaceMembers).values({ workspaceId: WS, userId: OWNER, role: "OWNER" });
  await db.insert(s.jurisdictionPolicies).values({
    scope: "workspace",
    workspaceId: WS,
    countryCode: "US",
    regionCode: "US-TX",
    outreachStatus: "allowed",
  });
});

describe("sample CSV", () => {
  it("produces the outcomes documented in samples/README.md", async () => {
    const bytes = new Uint8Array(
      readFileSync(path.join(process.cwd(), "samples", "leadvault-sample-prospects.csv")),
    );
    const actor = { workspaceId: WS, userId: OWNER };
    const created = await runAs((tx) =>
      createImport(tx, actor, { name: "leadvault-sample-prospects.csv", bytes }),
    );
    if (!created.ok) throw new Error(created.error.message);

    const headers = readFileSync(
      path.join(process.cwd(), "samples", "leadvault-sample-prospects.csv"),
      "utf8",
    )
      .split(/\r?\n/)[0]!
      .split(",");
    const { mapping, ambiguous } = suggestMapping(headers);
    expect(ambiguous).toEqual([]);
    // Every standard column maps automatically; only the custom "Specialty" column needs a choice.
    expect(
      Object.entries(mapping)
        .filter(([, t]) => t === "ignore")
        .map(([h]) => h),
    ).toEqual(["Specialty"]);
    mapping.Specialty = "custom:specialty";
    await runAs((tx) =>
      saveMapping(tx, actor, created.importId, mapping, [{ key: "specialty", label: "Specialty" }]),
    );
    await runAs((tx) =>
      validateImport(
        tx,
        actor,
        created.importId,
        {
          sourceLabel: "Sample file",
          reference: "",
          defaultCountryCode: "",
          defaultBusinessType: "",
          verificationMode: "trust",
          verificationSourceLabel: "LeadVault research",
          onExisting: "update",
        },
        NOW,
      ),
    );
    const result = await commitImport(runAs, actor, created.importId, NOW);
    expect(result.status).toBe("completed_with_issues");

    const { rows } = await runAs((tx) =>
      listImportRows(tx, WS, created.importId, { phase: "result", page: 1, size: 100 }),
    );
    // Data row n is spreadsheet row n + 1 (the header is row 1); README tables use spreadsheet rows.
    const byRow = new Map(
      rows.map((r) => [
        r.rowNumber + 1,
        { category: rowCategory(r.outcome, r.eligibility), reasons: r.eligibilityReasons },
      ]),
    );
    const expectRow = (n: number, category: string, reason?: string) => {
      const row = byRow.get(n);
      expect(row?.category, `row ${n}`).toBe(category);
      if (reason) expect(row?.reasons, `row ${n}`).toContain(reason);
    };
    expectRow(2, "ready");
    expectRow(3, "ready");
    expectRow(4, "review", "EMAIL_RISKY");
    expectRow(5, "review", "EMAIL_NOT_VERIFIED");
    expectRow(6, "review", "JURISDICTION_REVIEW");
    expectRow(7, "review", "JURISDICTION_REVIEW");
    expectRow(8, "review", "JURISDICTION_REVIEW");
    expectRow(9, "invalid");
    expectRow(10, "invalid");
    expectRow(11, "duplicate");
    expectRow(12, "review", "COUNTRY_UNKNOWN");
    expectRow(13, "review", "ROLE_BASED_EMAIL");
    expectRow(14, "ineligible", "MISSING_EMAIL");
    expectRow(15, "review", "EMAIL_NOT_VERIFIED");
    expectRow(16, "ready");
    expectRow(17, "review", "EMAIL_DOMAIN_UNKNOWN");
    expect(rows).toHaveLength(16);
  });
});
