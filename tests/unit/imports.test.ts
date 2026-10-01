import { describe, expect, it } from "vitest";
import {
  CSV_LIMITS,
  decodeCsvBytes,
  escapeCsvCell,
  parseCsvText,
  sanitizeFileName,
  toCsv,
} from "@/domain/imports/csv";
import {
  customFieldKeyFromHeader,
  suggestMapping,
  validateMapping,
  type ColumnMapping,
} from "@/domain/imports/fields";
import {
  buildCandidate,
  decideMatch,
  findInFileDuplicates,
  mergeIntoExisting,
  type ExistingProspect,
  type ImportSettings,
} from "@/domain/imports/plan";

const enc = (s: string) => new TextEncoder().encode(s);
const NOW = new Date("2026-10-01T00:00:00Z");

describe("CSV intake", () => {
  it("parses headers and rows, stripping a UTF-8 BOM", () => {
    const d = decodeCsvBytes(enc("\uFEFFCompany,Email\nAcme,a@acme.example\n"));
    expect(d.ok).toBe(true);
    const p = parseCsvText((d as { text: string }).text);
    expect(p.ok && p.csv.headers).toEqual(["Company", "Email"]);
    expect(p.ok && p.csv.rows).toEqual([
      { rowNumber: 1, cells: { Company: "Acme", Email: "a@acme.example" }, problems: [] },
    ]);
  });

  it("handles quoted fields with commas and newlines", () => {
    const p = parseCsvText('Company,Notes\n"Acme, Inc.","line 1\nline 2"\n');
    expect(p.ok && p.csv.rows[0]?.cells).toEqual({
      Company: "Acme, Inc.",
      Notes: "line 1\nline 2",
    });
  });

  it("rejects empty, binary, non-UTF-8 and oversized input", () => {
    expect(decodeCsvBytes(new Uint8Array())).toMatchObject({
      ok: false,
      error: { code: "EMPTY_FILE" },
    });
    expect(decodeCsvBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]))).toMatchObject({
      ok: false,
      error: { code: "BINARY_CONTENT" },
    });
    expect(decodeCsvBytes(new Uint8Array([0x43, 0x6f, 0xe9, 0x0a]))).toMatchObject({
      ok: false,
      error: { code: "INVALID_ENCODING" },
    });
    expect(decodeCsvBytes(new Uint8Array(CSV_LIMITS.maxBytes + 1).fill(65))).toMatchObject({
      ok: false,
      error: { code: "TOO_LARGE" },
    });
  });

  it("rejects files without data rows or with too many rows", () => {
    expect(parseCsvText("Company,Email\n")).toMatchObject({
      ok: false,
      error: { code: "NO_DATA_ROWS" },
    });
    expect(parseCsvText("\n\n")).toMatchObject({ ok: false, error: { code: "EMPTY_FILE" } });
    const big = "A\n" + "x\n".repeat(CSV_LIMITS.maxRows + 1);
    expect(parseCsvText(big)).toMatchObject({ ok: false, error: { code: "TOO_MANY_ROWS" } });
  });

  it("renames blank and duplicate headers and reports it", () => {
    const p = parseCsvText("Email,,Email\na,b,c\n");
    expect(p.ok && p.csv.headers).toEqual(["Email", "Column 2", "Email (2)"]);
    expect(p.ok && p.csv.headerNotes.length).toBe(2);
  });

  it("flags malformed rows instead of dropping them", () => {
    const p = parseCsvText("A,B\n1,2\n3\n4,5,6\n");
    expect(p.ok && p.csv.rows.map((r) => r.problems.length > 0)).toEqual([false, true, true]);
  });

  it("never evaluates cell content", () => {
    const p = parseCsvText('A\n"=HYPERLINK(""http://evil.example"")"\n');
    expect(p.ok && p.csv.rows[0]?.cells.A).toBe('=HYPERLINK("http://evil.example")');
  });

  it("sanitizes dangerous file names", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd.csv");
    expect(sanitizeFileName("C:\\Users\\x\\leads<script>.csv")).toBe("leadsscript.csv");
    expect(sanitizeFileName("...hidden.csv")).toBe("hidden.csv");
  });

  it("escapes spreadsheet formulas in exported CSV", () => {
    expect(escapeCsvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(escapeCsvCell("+1 555")).toBe("'+1 555");
    expect(escapeCsvCell("-2")).toBe("'-2");
    expect(escapeCsvCell("@cmd")).toBe("'@cmd");
    expect(escapeCsvCell('He said "hi", ok')).toBe('"He said ""hi"", ok"');
    expect(toCsv([["a", "=b"]])).toBe("a,'=b\r\n");
  });
});

describe("column mapping", () => {
  const delivery = [
    "COMPANY NAME",
    "WEBSITE",
    "CONTACT NAME",
    "CONTACT TITLE",
    "EMAIL ADDRESS",
    "PHONE NUMBER",
    "ADDRESS",
    "CITY",
    "STATE",
    "PROVIDER TYPE",
    "QUALIFICATION BASIS",
    "EVIDENCE URL",
  ];

  it("maps the LeadVault delivery layout completely", () => {
    const { mapping, ambiguous } = suggestMapping(delivery);
    expect(ambiguous).toEqual([]);
    expect(mapping).toEqual({
      "COMPANY NAME": "company_name",
      WEBSITE: "website",
      "CONTACT NAME": "contact_name",
      "CONTACT TITLE": "contact_title",
      "EMAIL ADDRESS": "email",
      "PHONE NUMBER": "phone",
      ADDRESS: "address_line",
      CITY: "city",
      STATE: "state",
      "PROVIDER TYPE": "business_type",
      "QUALIFICATION BASIS": "qualification_basis",
      "EVIDENCE URL": "evidence_url",
    });
  });

  it("suggests obvious variants", () => {
    const { mapping } = suggestMapping([
      "Company",
      "Contact Person",
      "Role",
      "Business Email",
      "verification_status",
    ]);
    expect(mapping).toMatchObject({
      Company: "company_name",
      "Contact Person": "contact_name",
      Role: "contact_title",
      "Business Email": "email",
      verification_status: "verification_status",
    });
  });

  it("never guesses ambiguous or unknown headers", () => {
    const { mapping, ambiguous } = suggestMapping(["Email", "E-mail", "Notes", "Specialty"]);
    expect(mapping).toEqual({
      Email: "ignore",
      "E-mail": "ignore",
      Notes: "ignore",
      Specialty: "ignore",
    });
    expect(ambiguous.sort()).toEqual(["E-mail", "Email"]);
  });

  it("suggests existing custom fields on exact key match only", () => {
    expect(suggestMapping(["Practice Size"], ["practice_size"]).mapping).toEqual({
      "Practice Size": "custom:practice_size",
    });
    expect(suggestMapping(["Practice Sizes"], ["practice_size"]).mapping).toEqual({
      "Practice Sizes": "ignore",
    });
  });

  it("rejects two columns mapped to the same field, unknown targets and a missing company", () => {
    const r = validateMapping(["A", "B", "C"], { A: "email", B: "email", C: "custom:nope" }, []);
    expect(r.ok).toBe(false);
    const codes = !r.ok ? r.problems.map((p) => p.code).sort() : [];
    expect(codes).toEqual(["COMPANY_NOT_MAPPED", "DUPLICATE_TARGET", "UNKNOWN_TARGET"]);
  });

  it("accepts a valid mapping", () => {
    expect(validateMapping(["A", "B"], { A: "company_name", B: "custom:size" }, ["size"])).toEqual({
      ok: true,
      mapping: { A: "company_name", B: "custom:size" },
    });
  });

  it("derives custom field keys from headers", () => {
    expect(customFieldKeyFromHeader("Practice Size (FTE)")).toBe("practice_size_fte");
    expect(customFieldKeyFromHeader("2024 Revenue")).toBe("revenue");
    expect(customFieldKeyFromHeader("!!")).toBeNull();
  });
});

describe("row planning", () => {
  const mapping: ColumnMapping = {
    Company: "company_name",
    Website: "website",
    Contact: "contact_name",
    Email: "email",
    Country: "country",
    State: "state",
    Status: "verification_status",
    Verified: "verified_at",
    Size: "custom:size",
  };
  const settings: ImportSettings = {
    defaultCountryCode: null,
    defaultBusinessType: null,
    verificationMode: "trust",
    verificationSourceLabel: "LeadVault research",
    onExisting: "update",
  };
  const row = (over: Record<string, string> = {}) => ({
    Company: "Acme Clinic",
    Website: "www.acme.example",
    Contact: "Dr. Jane Doe",
    Email: " Jane@Acme.Example ",
    Country: "USA",
    State: "Texas",
    Status: "valid",
    Verified: "2026-09-01",
    Size: "12",
    ...over,
  });

  it("normalizes a good row", () => {
    const b = buildCandidate(row(), mapping, settings, [], NOW);
    expect(b.disposition).toBe("ok");
    expect(b.candidate).toMatchObject({
      companyName: "Acme Clinic",
      websiteDomain: "acme.example",
      emailNormalized: "jane@acme.example",
      firstName: "Jane",
      lastName: "Doe",
      countryCode: "US",
      regionCode: "US-TX",
      verificationStatus: "VERIFIED",
      verificationSource: "LeadVault research",
      customFields: { size: "12" },
    });
  });

  it("marks invalid rows with explicit reasons", () => {
    expect(buildCandidate(row({ Email: "jane@acme" }), mapping, settings, [], NOW)).toMatchObject({
      disposition: "invalid",
      issues: expect.arrayContaining([expect.objectContaining({ code: "INVALID_EMAIL" })]),
    });
    expect(
      buildCandidate(row({ Company: "" }), mapping, settings, [], NOW).issues.map((i) => i.code),
    ).toContain("MISSING_REQUIRED_FIELD");
  });

  it("skips blank rows", () => {
    const blank = Object.fromEntries(Object.keys(row()).map((k) => [k, "  "]));
    expect(buildCandidate(blank, mapping, settings, [], NOW).disposition).toBe("skipped");
  });

  it("never assumes a country; applies the import default only to blank cells", () => {
    const none = buildCandidate(row({ Country: "" }), mapping, settings, [], NOW);
    expect(none.candidate?.countryCode).toBeNull();
    expect(none.issues.map((i) => i.code)).toContain("COUNTRY_MISSING");
    const withDefault = buildCandidate(
      row({ Country: "" }),
      mapping,
      { ...settings, defaultCountryCode: "NG" },
      [],
      NOW,
    );
    expect(withDefault.candidate?.countryCode).toBe("NG");
    expect(
      buildCandidate(
        row({ Country: "Canada" }),
        mapping,
        { ...settings, defaultCountryCode: "NG" },
        [],
        NOW,
      ).candidate?.countryCode,
    ).toBe("CA");
    const bad = buildCandidate(row({ Country: "Narnia" }), mapping, settings, [], NOW);
    expect(bad.disposition).toBe("ok");
    expect(bad.candidate?.countryCode).toBeNull();
    expect(bad.issues.map((i) => i.code)).toContain("INVALID_COUNTRY");
  });

  it("does not trust unrecognized or undated verification labels", () => {
    const unknownLabel = buildCandidate(row({ Status: "looks fine" }), mapping, settings, [], NOW);
    expect(unknownLabel.candidate?.verificationStatus).toBe("UNKNOWN");
    expect(unknownLabel.issues.map((i) => i.code)).toContain("VERIFICATION_NOT_TRUSTED");
    const undated = buildCandidate(row({ Verified: "09/01/2026" }), mapping, settings, [], NOW);
    expect(undated.candidate?.verificationStatus).toBe("UNKNOWN");
    expect(undated.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(["VERIFIED_AT_UNPARSEABLE"]),
    );
    const ignored = buildCandidate(
      row(),
      mapping,
      { ...settings, verificationMode: "ignore" },
      [],
      NOW,
    );
    expect(ignored.candidate?.verificationStatus).toBe("UNKNOWN");
  });

  it("detects duplicates within a file; the first occurrence wins", () => {
    const rows = [
      { rowNumber: 1, candidate: buildCandidate(row(), mapping, settings, [], NOW).candidate },
      {
        rowNumber: 2,
        candidate: buildCandidate(row({ Email: "JANE@acme.example" }), mapping, settings, [], NOW)
          .candidate,
      },
      {
        rowNumber: 3,
        candidate: buildCandidate(row({ Email: "other@acme.example" }), mapping, settings, [], NOW)
          .candidate,
      },
      {
        rowNumber: 4,
        candidate: buildCandidate(row({ Email: "" }), mapping, settings, [], NOW).candidate,
      },
      {
        rowNumber: 5,
        candidate: buildCandidate(
          row({ Email: "", Contact: " dr.  jane doe " }),
          mapping,
          settings,
          [],
          NOW,
        ).candidate,
      },
    ];
    // Row 5 differs from row 4 only by case/whitespace (no email): same prospect.
    expect([...findInFileDuplicates(rows)]).toEqual([
      [2, 1],
      [5, 4],
    ]);
  });

  it("merges without erasing, and recognizes identical re-imports", () => {
    const incoming = buildCandidate(row(), mapping, settings, [], NOW).candidate!;
    const existing: ExistingProspect = { ...incoming, id: "p1", contactTitle: "Practice Manager" };
    expect(
      decideMatch(incoming, { byEmail: existing, byRef: null, byFallback: null }, settings),
    ).toMatchObject({ outcome: "unchanged", existingId: "p1" });

    const changed = { ...incoming, city: "Austin" };
    const merged = mergeIntoExisting(existing, changed);
    expect(merged.changed).toEqual(["city"]);
    expect(merged.result.contactTitle).toBe("Practice Manager"); // blank incoming never erases

    expect(
      decideMatch(
        changed,
        { byEmail: existing, byRef: null, byFallback: null },
        { onExisting: "skip" },
      ),
    ).toMatchObject({ outcome: "duplicate_existing" });
  });

  it("only replaces verification with a recognized, newer result", () => {
    const incoming = buildCandidate(
      row({ Verified: "2026-06-01" }),
      mapping,
      settings,
      [],
      NOW,
    ).candidate!;
    const existing: ExistingProspect = {
      ...incoming,
      id: "p1",
      verifiedAt: new Date("2026-09-01"),
      verificationStatus: "INVALID",
    };
    expect(mergeIntoExisting(existing, incoming).result.verificationStatus).toBe("INVALID");
  });

  it("flags identity conflicts instead of merging two prospects", () => {
    const incoming = buildCandidate(row(), mapping, settings, [], NOW).candidate!;
    const a: ExistingProspect = { ...incoming, id: "a" };
    const b: ExistingProspect = { ...incoming, id: "b" };
    expect(
      decideMatch(incoming, { byEmail: a, byRef: b, byFallback: null }, settings).outcome,
    ).toBe("invalid");
  });
});
