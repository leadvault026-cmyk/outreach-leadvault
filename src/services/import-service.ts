import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppDatabase } from "@/db/rls";
import { prospectImportRows, prospectImports, prospects, workspaceCustomFields } from "@/db/schema";
import type { EligibilityStatus, ImportRowOutcome } from "@/domain/enums";
import {
  decodeCsvBytes,
  parseCsvText,
  sanitizeFileName,
  type CsvParseError,
} from "@/domain/imports/csv";
import type { ColumnMapping } from "@/domain/imports/fields";
import {
  buildCandidate,
  decideMatch,
  findInFileDuplicates,
  identityKeys,
  type Candidate,
  type ExistingProspect,
  type ImportSettings,
  type RowIssue,
} from "@/domain/imports/plan";
import { uuidv7 } from "@/lib/ids";
import {
  evaluateSubject,
  loadPolicies,
  loadSuppressionContext,
  writeEligibility,
} from "./eligibility-service";

/**
 * Import lifecycle (Phase 2 §AJ):
 *   uploaded → mapped → ready (validated) → importing → completed | completed_with_issues | failed
 * Every source row is stored verbatim at upload and always ends with an explainable outcome.
 */

export type Actor = { workspaceId: string; userId: string };
export type TxRunner = <T>(fn: (tx: AppDatabase) => Promise<T>) => Promise<T>;

export const importSettingsSchema = z.object({
  sourceLabel: z.string().trim().min(1, "Give the import a name.").max(120),
  reference: z.string().trim().max(300).optional().default(""),
  defaultCountryCode: z
    .string()
    .trim()
    .transform((v) => (v ? v.toUpperCase() : null))
    .pipe(
      z
        .string()
        .regex(/^[A-Z]{2}$/)
        .nullable(),
    ),
  defaultBusinessType: z
    .string()
    .trim()
    .max(120)
    .transform((v) => v || null),
  verificationMode: z.enum(["trust", "ignore"]),
  verificationSourceLabel: z.string().trim().min(1).max(120).default("LeadVault research"),
  onExisting: z.enum(["update", "skip"]),
});
export type ImportSettingsInput = z.input<typeof importSettingsSchema>;
export type StoredSettings = z.output<typeof importSettingsSchema>;

type StoredOptions = {
  headers: string[];
  headerNotes: string[];
  settings?: StoredSettings;
  summary?: PlanSummary;
  failure?: string;
};

export class ImportError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ImportError";
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ───────────────────────────── Upload ─────────────────────────────

export async function createImport(
  db: AppDatabase,
  actor: Actor,
  file: { name: string; bytes: Uint8Array },
): Promise<
  | {
      ok: true;
      importId: string;
      rowCount: number;
      previous: { id: string; sourceLabel: string | null; createdAt: Date } | null;
    }
  | { ok: false; error: CsvParseError }
> {
  const decoded = decodeCsvBytes(file.bytes);
  if (!decoded.ok) return decoded;
  const parsed = parseCsvText(decoded.text);
  if (!parsed.ok) return parsed;
  const { headers, rows, headerNotes } = parsed.csv;

  const sha = await sha256Hex(file.bytes);
  const [previous] = await db
    .select({
      id: prospectImports.id,
      sourceLabel: prospectImports.sourceLabel,
      createdAt: prospectImports.createdAt,
    })
    .from(prospectImports)
    .where(
      and(eq(prospectImports.workspaceId, actor.workspaceId), eq(prospectImports.fileSha256, sha)),
    )
    .orderBy(desc(prospectImports.createdAt))
    .limit(1);

  const importId = uuidv7();
  const fileName = sanitizeFileName(file.name);
  await db.insert(prospectImports).values({
    id: importId,
    workspaceId: actor.workspaceId,
    createdBy: actor.userId,
    fileName,
    sourceLabel: fileName.replace(/\.csv$/i, ""),
    fileSha256: sha,
    rowCount: rows.length,
    status: "uploaded",
    options: { headers, headerNotes } satisfies StoredOptions,
  });
  for (let i = 0; i < rows.length; i += 1000) {
    await db.insert(prospectImportRows).values(
      rows.slice(i, i + 1000).map((r) => ({
        importId,
        rowNumber: r.rowNumber,
        workspaceId: actor.workspaceId,
        raw: r.cells,
        outcome: "pending" as const,
        issues: r.problems.map((m): RowIssue =>
          m.includes("was longer than")
            ? { code: "CELL_TRUNCATED", severity: "warning", message: m }
            : { code: "MALFORMED_ROW", severity: "error", message: m },
        ),
      })),
    );
  }
  return { ok: true, importId, rowCount: rows.length, previous: previous ?? null };
}

// ───────────────────────────── Read ─────────────────────────────

export async function getImport(db: AppDatabase, workspaceId: string, importId: string) {
  const [row] = await db
    .select()
    .from(prospectImports)
    .where(and(eq(prospectImports.workspaceId, workspaceId), eq(prospectImports.id, importId)))
    .limit(1);
  if (!row) return null;
  const options = (row.options ?? { headers: [], headerNotes: [] }) as StoredOptions;
  return { ...row, options, mapping: (row.columnMapping ?? null) as ColumnMapping | null };
}

export async function listImports(db: AppDatabase, workspaceId: string, limit = 100) {
  return db
    .select({
      id: prospectImports.id,
      sourceLabel: prospectImports.sourceLabel,
      fileName: prospectImports.fileName,
      status: prospectImports.status,
      createdBy: prospectImports.createdBy,
      createdAt: prospectImports.createdAt,
      startedAt: prospectImports.startedAt,
      completedAt: prospectImports.completedAt,
      rowCount: prospectImports.rowCount,
      createdCount: prospectImports.createdCount,
      updatedCount: prospectImports.updatedCount,
      unchangedCount: prospectImports.unchangedCount,
      skippedCount: prospectImports.skippedCount,
      duplicateCount: prospectImports.duplicateCount,
      invalidCount: prospectImports.invalidCount,
      errorCount: prospectImports.errorCount,
      reviewCount: prospectImports.reviewCount,
      suppressedCount: prospectImports.suppressedCount,
      creatorEmail: sql<
        string | null
      >`(select p.email from app.profiles p where p.user_id = "app"."prospect_imports"."created_by")`,
    })
    .from(prospectImports)
    .where(eq(prospectImports.workspaceId, workspaceId))
    .orderBy(desc(prospectImports.createdAt))
    .limit(limit);
}

/** Display category for a row (preview and results share it). */
export const ROW_CATEGORIES = [
  "ready",
  "review",
  "ineligible",
  "suppressed",
  "duplicate",
  "invalid",
  "skipped",
  "error",
] as const;
export type RowCategory = (typeof ROW_CATEGORIES)[number];

export function rowCategory(
  outcome: ImportRowOutcome | null,
  eligibility: EligibilityStatus | null,
): RowCategory {
  switch (outcome) {
    case "invalid":
      return "invalid";
    case "skipped":
      return "skipped";
    case "error":
      return "error";
    case "duplicate_in_file":
    case "duplicate_existing":
      return "duplicate";
    default:
      if (eligibility === "SUPPRESSED") return "suppressed";
      if (eligibility === "INELIGIBLE") return "ineligible";
      if (eligibility === "NEEDS_REVIEW") return "review";
      return "ready";
  }
}

const CATEGORY_SQL: Record<
  RowCategory,
  (col: "outcome" | "planned_outcome") => ReturnType<typeof sql>
> = {
  invalid: (c) => sql`${sql.raw(c)} = 'invalid'`,
  skipped: (c) => sql`${sql.raw(c)} = 'skipped'`,
  error: (c) => sql`${sql.raw(c)} = 'error'`,
  duplicate: (c) => sql`${sql.raw(c)} in ('duplicate_in_file', 'duplicate_existing')`,
  suppressed: (c) =>
    sql`${sql.raw(c)} in ('create', 'update', 'unchanged') and eligibility = 'SUPPRESSED'`,
  ineligible: (c) =>
    sql`${sql.raw(c)} in ('create', 'update', 'unchanged') and eligibility = 'INELIGIBLE'`,
  review: (c) =>
    sql`${sql.raw(c)} in ('create', 'update', 'unchanged') and eligibility = 'NEEDS_REVIEW'`,
  ready: (c) =>
    sql`${sql.raw(c)} in ('create', 'update', 'unchanged') and eligibility = 'ELIGIBLE'`,
};

export async function listImportRows(
  db: AppDatabase,
  workspaceId: string,
  importId: string,
  opts: { phase: "preview" | "result"; category?: RowCategory; page: number; size: number },
) {
  const col = opts.phase === "preview" ? "planned_outcome" : "outcome";
  const where = and(
    eq(prospectImportRows.workspaceId, workspaceId),
    eq(prospectImportRows.importId, importId),
    opts.category ? CATEGORY_SQL[opts.category](col) : undefined,
  );
  const [{ total } = { total: 0 }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(prospectImportRows)
    .where(where);
  const rows = await db
    .select()
    .from(prospectImportRows)
    .where(where)
    .orderBy(prospectImportRows.rowNumber)
    .limit(opts.size)
    .offset((opts.page - 1) * opts.size);
  return { total, rows };
}

export async function categoryCounts(
  db: AppDatabase,
  workspaceId: string,
  importId: string,
  phase: "preview" | "result",
): Promise<Record<RowCategory, number>> {
  const col = phase === "preview" ? prospectImportRows.plannedOutcome : prospectImportRows.outcome;
  const grouped = await db
    .select({
      outcome: col,
      eligibility: prospectImportRows.eligibility,
      n: sql<number>`count(*)::int`,
    })
    .from(prospectImportRows)
    .where(
      and(
        eq(prospectImportRows.workspaceId, workspaceId),
        eq(prospectImportRows.importId, importId),
      ),
    )
    .groupBy(col, prospectImportRows.eligibility);
  const counts = Object.fromEntries(ROW_CATEGORIES.map((c) => [c, 0])) as Record<
    RowCategory,
    number
  >;
  for (const g of grouped) {
    if (!g.outcome || g.outcome === "pending") continue;
    counts[rowCategory(g.outcome, g.eligibility)] += g.n;
  }
  return counts;
}

// ───────────────────────────── Mapping ─────────────────────────────

const EDITABLE: ReadonlyArray<string> = ["uploaded", "mapped", "ready"];

export async function saveMapping(
  db: AppDatabase,
  actor: Actor,
  importId: string,
  mapping: ColumnMapping,
  newCustomFields: ReadonlyArray<{ key: string; label: string }>,
): Promise<void> {
  const imp = await getImport(db, actor.workspaceId, importId);
  if (!imp) throw new ImportError("NOT_FOUND", "Import not found.");
  if (!EDITABLE.includes(imp.status))
    throw new ImportError("LOCKED", "This import has already run.");
  if (newCustomFields.length) {
    await db
      .insert(workspaceCustomFields)
      .values(
        newCustomFields.map((f) => ({
          workspaceId: actor.workspaceId,
          key: f.key,
          label: f.label,
        })),
      )
      .onConflictDoNothing();
  }
  await db
    .update(prospectImports)
    .set({ columnMapping: mapping, status: "mapped" })
    .where(
      and(eq(prospectImports.workspaceId, actor.workspaceId), eq(prospectImports.id, importId)),
    );
}

export async function listCustomFieldKeys(db: AppDatabase, workspaceId: string) {
  return db
    .select({ key: workspaceCustomFields.key, label: workspaceCustomFields.label })
    .from(workspaceCustomFields)
    .where(eq(workspaceCustomFields.workspaceId, workspaceId))
    .orderBy(workspaceCustomFields.key);
}

// ───────────────────────────── Planning ─────────────────────────────

export type PlannedRow = {
  rowNumber: number;
  outcome: ImportRowOutcome;
  issues: RowIssue[];
  eligibility: EligibilityStatus | null;
  reasons: string[];
  existingId: string | null;
  result: Candidate | null;
  changedFields: string[];
  duplicateOf: number | null;
};

export type PlanSummary = {
  total: number;
  create: number;
  update: number;
  unchanged: number;
  duplicate: number;
  invalid: number;
  skipped: number;
  eligible: number;
  review: number;
  ineligible: number;
  suppressed: number;
};

const prospectSnapshotColumns = {
  id: prospects.id,
  companyName: prospects.companyName,
  website: prospects.website,
  websiteDomain: prospects.websiteDomain,
  contactName: prospects.contactName,
  firstName: prospects.firstName,
  lastName: prospects.lastName,
  contactTitle: prospects.contactTitle,
  email: prospects.email,
  emailNormalized: prospects.emailNormalized,
  emailDomain: prospects.emailDomain,
  phone: prospects.phone,
  addressLine: prospects.addressLine,
  city: prospects.city,
  state: prospects.state,
  postalCode: prospects.postalCode,
  countryCode: prospects.countryCode,
  regionCode: prospects.regionCode,
  businessType: prospects.businessType,
  qualificationBasis: prospects.qualificationBasis,
  evidenceUrl: prospects.evidenceUrl,
  researchSourceRef: prospects.researchSourceRef,
  verificationStatus: prospects.emailVerificationStatus,
  verifiedAt: prospects.emailVerifiedAt,
  verificationSource: prospects.emailVerificationSource,
  verificationDetail: prospects.emailVerificationDetail,
  customFields: prospects.customFields,
};

async function chunkedSelect<T>(
  values: string[],
  size: number,
  fn: (chunk: string[]) => Promise<T[]>,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < values.length; i += size) out.push(...(await fn(values.slice(i, i + size))));
  return out;
}

/** Plans every row of an import against the current database state. Read-only. */
export async function planImportRows(
  db: AppDatabase,
  workspaceId: string,
  rows: ReadonlyArray<{ rowNumber: number; raw: Record<string, string>; issues: RowIssue[] }>,
  mapping: ColumnMapping,
  settings: ImportSettings,
  now = new Date(),
): Promise<{ planned: PlannedRow[]; summary: PlanSummary }> {
  const built = rows.map((r) => {
    const parseIssues = r.issues.filter(
      (i) => i.code === "MALFORMED_ROW" || i.code === "CELL_TRUNCATED",
    );
    const b = buildCandidate(r.raw, mapping, settings, [], now);
    const disposition =
      parseIssues.some((i) => i.severity === "error") && b.disposition === "ok"
        ? "invalid"
        : b.disposition;
    return { rowNumber: r.rowNumber, ...b, issues: [...parseIssues, ...b.issues], disposition };
  });
  const usable = built.filter((b) => b.disposition === "ok");
  const dupes = findInFileDuplicates(
    usable.map((b) => ({ rowNumber: b.rowNumber, candidate: b.candidate })),
  );

  // Existing prospects in THIS workspace that could match.
  const keys = usable.map((b) => identityKeys(b.candidate!));
  const emails = [...new Set(keys.map((k) => k.email).filter((x): x is string => Boolean(x)))];
  const refs = [...new Set(keys.map((k) => k.ref).filter((x): x is string => Boolean(x)))];
  const companies = [
    ...new Set(
      usable
        .filter((_, i) => keys[i]!.fallback)
        .map((b) => b.candidate!.companyName!.toLowerCase()),
    ),
  ];
  const ws = eq(prospects.workspaceId, workspaceId);
  const byEmailRows = await chunkedSelect(emails, 2000, (c) =>
    db
      .select(prospectSnapshotColumns)
      .from(prospects)
      .where(and(ws, inArray(prospects.emailNormalized, c))),
  );
  const byRefRows = await chunkedSelect(refs, 2000, (c) =>
    db
      .select(prospectSnapshotColumns)
      .from(prospects)
      .where(and(ws, inArray(prospects.researchSourceRef, c))),
  );
  const fallbackRows = await chunkedSelect(companies, 2000, (c) =>
    db
      .select(prospectSnapshotColumns)
      .from(prospects)
      .where(
        and(
          ws,
          isNull(prospects.emailNormalized),
          inArray(sql`lower(${prospects.companyName})`, c),
        ),
      ),
  );
  const toExisting = (p: (typeof byEmailRows)[number]): ExistingProspect => ({
    ...p,
    customFields: Object.fromEntries(
      Object.entries(p.customFields ?? {}).map(([k, v]) => [k, v === null ? "" : String(v)]),
    ),
  });
  const byEmail = new Map(byEmailRows.map((p) => [p.emailNormalized!, toExisting(p)]));
  const byRef = new Map(byRefRows.map((p) => [p.researchSourceRef!, toExisting(p)]));
  const byFallback = new Map(
    fallbackRows
      .filter((p) => !p.researchSourceRef)
      .map((p) => {
        const e = toExisting(p);
        return [identityKeys(e).fallback!, e];
      }),
  );

  const policies = await loadPolicies(db, workspaceId);
  const decisions = new Map<number, ReturnType<typeof decideMatch>>();
  for (const b of usable) {
    if (dupes.has(b.rowNumber)) continue;
    const k = identityKeys(b.candidate!);
    decisions.set(
      b.rowNumber,
      decideMatch(
        b.candidate!,
        {
          byEmail: k.email ? (byEmail.get(k.email) ?? null) : null,
          byRef: k.ref ? (byRef.get(k.ref) ?? null) : null,
          byFallback: k.fallback ? (byFallback.get(k.fallback) ?? null) : null,
        },
        settings,
      ),
    );
  }
  const subjects = [...decisions.values()].map((d) => d.result);
  const ctx = await loadSuppressionContext(
    db,
    workspaceId,
    subjects.map((s) => s.emailNormalized).filter((e): e is string => Boolean(e)),
    subjects.map((s) => s.emailDomain).filter((d): d is string => Boolean(d)),
  );

  const planned: PlannedRow[] = built.map((b) => {
    const base = {
      rowNumber: b.rowNumber,
      issues: b.issues,
      existingId: null,
      changedFields: [] as string[],
      duplicateOf: null,
    };
    if (b.disposition === "skipped")
      return { ...base, outcome: "skipped", eligibility: null, reasons: [], result: null };
    if (b.disposition === "invalid")
      return { ...base, outcome: "invalid", eligibility: null, reasons: [], result: b.candidate };
    const dupOf = dupes.get(b.rowNumber);
    if (dupOf !== undefined) {
      return {
        ...base,
        outcome: "duplicate_in_file",
        duplicateOf: dupOf,
        issues: [
          ...b.issues,
          {
            code: "DUPLICATE_IN_FILE",
            severity: "info",
            message: `Same prospect as row ${dupOf}; only the first occurrence is imported.`,
          },
        ],
        eligibility: null,
        reasons: [],
        result: b.candidate,
      };
    }
    const d = decisions.get(b.rowNumber)!;
    if (d.outcome === "invalid") {
      return {
        ...base,
        outcome: "invalid",
        issues: [...b.issues, ...d.issues],
        eligibility: null,
        reasons: [],
        result: b.candidate,
      };
    }
    const elig = evaluateSubject(workspaceId, { ...d.result }, policies, ctx, now);
    return {
      ...base,
      outcome: d.outcome,
      issues: [...b.issues, ...d.issues],
      existingId: d.existingId,
      changedFields: d.changedFields,
      eligibility: elig.status,
      reasons: elig.reasons,
      result: d.result,
    };
  });

  const summary: PlanSummary = {
    total: planned.length,
    create: 0,
    update: 0,
    unchanged: 0,
    duplicate: 0,
    invalid: 0,
    skipped: 0,
    eligible: 0,
    review: 0,
    ineligible: 0,
    suppressed: 0,
  };
  for (const p of planned) {
    if (p.outcome === "create") summary.create++;
    else if (p.outcome === "update") summary.update++;
    else if (p.outcome === "unchanged") summary.unchanged++;
    else if (p.outcome === "duplicate_in_file" || p.outcome === "duplicate_existing")
      summary.duplicate++;
    else if (p.outcome === "invalid") summary.invalid++;
    else if (p.outcome === "skipped") summary.skipped++;
    if (p.eligibility === "ELIGIBLE") summary.eligible++;
    else if (p.eligibility === "NEEDS_REVIEW") summary.review++;
    else if (p.eligibility === "INELIGIBLE") summary.ineligible++;
    else if (p.eligibility === "SUPPRESSED") summary.suppressed++;
  }
  return { planned, summary };
}

function displayValues(p: PlannedRow): Record<string, unknown> {
  const r = p.result;
  return {
    ...(r
      ? {
          companyName: r.companyName,
          contactName: r.contactName,
          contactTitle: r.contactTitle,
          email: r.emailNormalized,
          websiteDomain: r.websiteDomain,
          phone: r.phone,
          city: r.city,
          state: r.state,
          countryCode: r.countryCode,
          regionCode: r.regionCode,
          businessType: r.businessType,
          verificationStatus: r.verificationStatus,
          verifiedAt: r.verifiedAt?.toISOString() ?? null,
          evidenceUrl: r.evidenceUrl,
        }
      : {}),
    existingId: p.existingId,
    changedFields: p.changedFields,
    duplicateOf: p.duplicateOf,
  };
}

/** Bulk-update import rows from a JSON recordset (one statement per chunk). */
async function writeRowResults(
  db: AppDatabase,
  workspaceId: string,
  importId: string,
  planned: PlannedRow[],
  mode: "preview" | "result",
  prospectIds: Map<number, string> = new Map(),
): Promise<void> {
  for (let i = 0; i < planned.length; i += 500) {
    const chunk = planned.slice(i, i + 500).map((p) => ({
      row_number: p.rowNumber,
      outcome: p.outcome,
      issues: p.issues,
      mapped: displayValues(p),
      eligibility: p.eligibility,
      eligibility_reasons: p.reasons,
      prospect_id: prospectIds.get(p.rowNumber) ?? null,
    }));
    const json = JSON.stringify(chunk);
    if (mode === "preview") {
      await db.execute(sql`
        update app.prospect_import_rows r set
          planned_outcome = v.outcome, issues = v.issues, mapped = v.mapped,
          eligibility = v.eligibility, eligibility_reasons = coalesce(v.eligibility_reasons, '{}')
        from jsonb_to_recordset(${json}::jsonb) as v(row_number int, outcome text, issues jsonb, mapped jsonb, eligibility text, eligibility_reasons text[])
        where r.workspace_id = ${workspaceId} and r.import_id = ${importId} and r.row_number = v.row_number`);
    } else {
      await db.execute(sql`
        update app.prospect_import_rows r set
          outcome = v.outcome, issues = v.issues, mapped = v.mapped, eligibility = v.eligibility,
          eligibility_reasons = coalesce(v.eligibility_reasons, '{}'), prospect_id = v.prospect_id
        from jsonb_to_recordset(${json}::jsonb) as v(row_number int, outcome text, issues jsonb, mapped jsonb, eligibility text, eligibility_reasons text[], prospect_id uuid)
        where r.workspace_id = ${workspaceId} and r.import_id = ${importId} and r.row_number = v.row_number`);
    }
  }
}

async function loadRows(db: AppDatabase, workspaceId: string, importId: string) {
  return db
    .select({
      rowNumber: prospectImportRows.rowNumber,
      raw: prospectImportRows.raw,
      issues: prospectImportRows.issues,
    })
    .from(prospectImportRows)
    .where(
      and(
        eq(prospectImportRows.workspaceId, workspaceId),
        eq(prospectImportRows.importId, importId),
      ),
    )
    .orderBy(prospectImportRows.rowNumber);
}

// ───────────────────────────── Validate & preview ─────────────────────────────

export async function validateImport(
  db: AppDatabase,
  actor: Actor,
  importId: string,
  settingsInput: ImportSettingsInput,
  now = new Date(),
): Promise<PlanSummary> {
  const imp = await getImport(db, actor.workspaceId, importId);
  if (!imp) throw new ImportError("NOT_FOUND", "Import not found.");
  if (!imp.mapping) throw new ImportError("NOT_MAPPED", "Map the columns first.");
  if (!EDITABLE.includes(imp.status))
    throw new ImportError("LOCKED", "This import has already run.");
  const settings = importSettingsSchema.parse(settingsInput);

  const rows = await loadRows(db, actor.workspaceId, importId);
  const { planned, summary } = await planImportRows(
    db,
    actor.workspaceId,
    rows,
    imp.mapping,
    settings,
    now,
  );
  await writeRowResults(db, actor.workspaceId, importId, planned, "preview");
  await db
    .update(prospectImports)
    .set({
      status: "ready",
      sourceLabel: settings.sourceLabel,
      defaultCountryCode: settings.defaultCountryCode,
      options: { ...imp.options, settings, summary } satisfies StoredOptions,
    })
    .where(
      and(eq(prospectImports.workspaceId, actor.workspaceId), eq(prospectImports.id, importId)),
    );
  return summary;
}

// ───────────────────────────── Commit ─────────────────────────────

function prospectValues(c: Candidate) {
  return {
    companyName: c.companyName!,
    website: c.website,
    websiteDomain: c.websiteDomain,
    contactName: c.contactName,
    firstName: c.firstName,
    lastName: c.lastName,
    contactTitle: c.contactTitle,
    email: c.email,
    emailNormalized: c.emailNormalized,
    emailDomain: c.emailDomain,
    phone: c.phone,
    addressLine: c.addressLine,
    city: c.city,
    state: c.state,
    postalCode: c.postalCode,
    countryCode: c.countryCode,
    regionCode: c.regionCode,
    businessType: c.businessType,
    qualificationBasis: c.qualificationBasis,
    evidenceUrl: c.evidenceUrl,
    researchSourceRef: c.researchSourceRef,
    emailVerificationStatus: c.verificationStatus,
    emailVerifiedAt: c.verifiedAt,
    emailVerificationSource: c.verificationSource,
    emailVerificationDetail: c.verificationDetail,
    customFields: c.customFields,
  };
}

export type CommitResult = {
  status: "completed" | "completed_with_issues" | "failed";
  summary: PlanSummary;
  errorRows: number;
};

/**
 * Runs the import. Each batch commits in its own transaction; a failing batch marks its rows
 * `error` (with the reason) and the rest continue, so the final state is never ambiguous.
 * The import is claimed first (ready → importing) so it can only run once.
 */
export async function commitImport(
  run: TxRunner,
  actor: Actor,
  importId: string,
  now = new Date(),
): Promise<CommitResult> {
  const claimed = await run((tx) =>
    tx
      .update(prospectImports)
      .set({ status: "importing", startedAt: now })
      .where(
        and(
          eq(prospectImports.workspaceId, actor.workspaceId),
          eq(prospectImports.id, importId),
          eq(prospectImports.status, "ready"),
        ),
      )
      .returning({ id: prospectImports.id }),
  );
  if (!claimed.length)
    throw new ImportError(
      "NOT_READY",
      "This import is not ready to run (it may already have run).",
    );

  let planned: PlannedRow[];
  let summary: PlanSummary;
  try {
    ({ planned, summary } = await run(async (tx) => {
      const imp = await getImport(tx, actor.workspaceId, importId);
      if (!imp?.mapping || !imp.options.settings)
        throw new ImportError("NOT_MAPPED", "Import settings are missing.");
      const rows = await loadRows(tx, actor.workspaceId, importId);
      return planImportRows(tx, actor.workspaceId, rows, imp.mapping, imp.options.settings, now);
    }));
  } catch (error) {
    await run(async (tx) => {
      await tx.execute(sql`
        update app.prospect_import_rows set outcome = 'error',
          issues = issues || ${JSON.stringify([{ code: "IMPORT_FAILED", severity: "error", message: "Not processed: the import could not start." }])}::jsonb
        where workspace_id = ${actor.workspaceId} and import_id = ${importId} and outcome = 'pending'`);
      await tx
        .update(prospectImports)
        .set({
          status: "failed",
          errorCode: error instanceof ImportError ? error.code : "PLANNING_FAILED",
          completedAt: new Date(),
        })
        .where(
          and(eq(prospectImports.workspaceId, actor.workspaceId), eq(prospectImports.id, importId)),
        );
    });
    return { status: "failed", summary: emptySummary(), errorRows: 0 };
  }

  let errorRows = 0;
  for (let i = 0; i < planned.length; i += 500) {
    const batch = planned.slice(i, i + 500);
    try {
      await run(async (tx) => {
        const ids = new Map<number, string>();
        const creates = batch.filter((p) => p.outcome === "create");
        if (creates.length) {
          const values = creates.map((p) => {
            const id = uuidv7();
            ids.set(p.rowNumber, id);
            return {
              id,
              workspaceId: actor.workspaceId,
              ...prospectValues(p.result!),
              firstImportId: importId,
              lastImportId: importId,
            };
          });
          await tx.insert(prospects).values(values);
        }
        for (const p of batch) {
          if (
            (p.outcome === "update" ||
              p.outcome === "unchanged" ||
              p.outcome === "duplicate_existing") &&
            p.existingId
          ) {
            ids.set(p.rowNumber, p.existingId);
          }
          if (p.outcome === "update" && p.existingId) {
            await tx
              .update(prospects)
              .set({ ...prospectValues(p.result!), lastImportId: importId })
              .where(
                and(eq(prospects.workspaceId, actor.workspaceId), eq(prospects.id, p.existingId)),
              );
          }
        }
        // Cache eligibility for every stored prospect touched by this batch.
        const evaluated = batch
          .filter(
            (p) =>
              (p.outcome === "create" || p.outcome === "update" || p.outcome === "unchanged") &&
              p.eligibility,
          )
          .map((p) => ({ prospectId: ids.get(p.rowNumber)!, p }));
        if (evaluated.length) {
          const policies = await loadPolicies(tx, actor.workspaceId);
          const subjects = evaluated.map((e) => e.p.result!);
          const ctx = await loadSuppressionContext(
            tx,
            actor.workspaceId,
            subjects.map((s) => s.emailNormalized).filter((e): e is string => Boolean(e)),
            subjects.map((s) => s.emailDomain).filter((d): d is string => Boolean(d)),
          );
          await writeEligibility(
            tx,
            actor.workspaceId,
            evaluated.map((e) => ({
              prospectId: e.prospectId,
              result: evaluateSubject(actor.workspaceId, e.p.result!, policies, ctx, now),
            })),
            now,
          );
        }
        await writeRowResults(tx, actor.workspaceId, importId, batch, "result", ids);
      });
    } catch (error) {
      errorRows += batch.length;
      const message =
        error instanceof Error &&
        /duplicate key|unique/i.test(
          `${error.message} ${String((error as { cause?: unknown }).cause ?? "")}`,
        )
          ? "Not saved: another change created a conflicting prospect while this import ran. Re-import the file to retry."
          : "Not saved: an unexpected error occurred while saving this batch.";
      await run((tx) =>
        writeRowResults(
          tx,
          actor.workspaceId,
          importId,
          batch.map((p) => ({
            ...p,
            outcome: "error",
            issues: [...p.issues, { code: "SAVE_FAILED", severity: "error", message }],
          })),
          "result",
        ),
      );
    }
  }

  return run(async (tx) => {
    const counts = await categoryCounts(tx, actor.workspaceId, importId, "result");
    const byOutcome = await tx
      .select({ outcome: prospectImportRows.outcome, n: sql<number>`count(*)::int` })
      .from(prospectImportRows)
      .where(
        and(
          eq(prospectImportRows.workspaceId, actor.workspaceId),
          eq(prospectImportRows.importId, importId),
        ),
      )
      .groupBy(prospectImportRows.outcome);
    const n = (o: ImportRowOutcome) => byOutcome.find((b) => b.outcome === o)?.n ?? 0;
    const status: CommitResult["status"] =
      errorRows === planned.length && planned.length > 0
        ? "failed"
        : n("invalid") + n("error") > 0
          ? "completed_with_issues"
          : "completed";
    await tx
      .update(prospectImports)
      .set({
        status,
        completedAt: new Date(),
        createdCount: n("create"),
        updatedCount: n("update"),
        unchangedCount: n("unchanged"),
        duplicateCount: n("duplicate_in_file") + n("duplicate_existing"),
        invalidCount: n("invalid"),
        skippedCount: n("skipped"),
        errorCount: n("error"),
        reviewCount: counts.review + counts.ineligible,
        suppressedCount: counts.suppressed,
        errorCode: status === "failed" ? "ALL_BATCHES_FAILED" : null,
      })
      .where(
        and(eq(prospectImports.workspaceId, actor.workspaceId), eq(prospectImports.id, importId)),
      );
    return { status, summary: summary!, errorRows };
  });
}

function emptySummary(): PlanSummary {
  return {
    total: 0,
    create: 0,
    update: 0,
    unchanged: 0,
    duplicate: 0,
    invalid: 0,
    skipped: 0,
    eligible: 0,
    review: 0,
    ineligible: 0,
    suppressed: 0,
  };
}

export async function cancelImport(
  db: AppDatabase,
  actor: Actor,
  importId: string,
): Promise<boolean> {
  const rows = await db
    .update(prospectImports)
    .set({ status: "cancelled", completedAt: new Date() })
    .where(
      and(
        eq(prospectImports.workspaceId, actor.workspaceId),
        eq(prospectImports.id, importId),
        inArray(prospectImports.status, ["uploaded", "mapped", "ready"]),
      ),
    )
    .returning({ id: prospectImports.id });
  if (rows.length) {
    await db.execute(sql`
      update app.prospect_import_rows set outcome = 'skipped',
        issues = issues || ${JSON.stringify([{ code: "IMPORT_CANCELLED", severity: "info", message: "Not imported: the import was cancelled." }])}::jsonb
      where workspace_id = ${actor.workspaceId} and import_id = ${importId} and outcome = 'pending'`);
  }
  return rows.length > 0;
}
