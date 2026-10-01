import type { EmailVerificationStatus, ImportRowOutcome } from "../enums";
import { normalizeCountry, normalizeRegion } from "../geo";
import {
  cleanText,
  normalizeEmail,
  normalizeEvidenceUrl,
  normalizePhone,
  normalizeWebsite,
  parseIsoDate,
  splitContactName,
} from "../prospects/normalize";
import { buildVerificationRecord } from "../verification";
import type { ColumnMapping } from "./fields";

/**
 * Pure import planner (Phase 2 §H–§M): mapped CSV row → normalized prospect candidate + issues,
 * within-file duplicate detection, and the create/update/unchanged decision against existing
 * records. The database service supplies lookups; this module never touches the database.
 */

export type ImportSettings = {
  /** ISO alpha-2 applied ONLY to rows with no country value. Null = leave unknown. */
  defaultCountryCode: string | null;
  defaultBusinessType: string | null;
  /** 'trust' = map recognized labels from the research system; 'ignore' = drop verification columns. */
  verificationMode: "trust" | "ignore";
  verificationSourceLabel: string;
  /** What to do when a row matches an existing prospect in this workspace. */
  onExisting: "update" | "skip";
};

export type IssueSeverity = "error" | "warning" | "info";
export type RowIssue = { code: string; field?: string; severity: IssueSeverity; message: string };

/** Typed research fields of a prospect candidate (matches the prospects table). */
export type Candidate = {
  companyName: string | null;
  website: string | null;
  websiteDomain: string | null;
  contactName: string | null;
  firstName: string | null;
  lastName: string | null;
  contactTitle: string | null;
  email: string | null;
  emailNormalized: string | null;
  emailDomain: string | null;
  phone: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  countryCode: string | null;
  regionCode: string | null;
  businessType: string | null;
  qualificationBasis: string | null;
  evidenceUrl: string | null;
  researchSourceRef: string | null;
  verificationStatus: EmailVerificationStatus;
  verifiedAt: Date | null;
  verificationSource: string | null;
  verificationDetail: string | null;
  customFields: Record<string, string>;
};

export const RESEARCH_FIELDS = [
  "companyName",
  "website",
  "websiteDomain",
  "contactName",
  "firstName",
  "lastName",
  "contactTitle",
  "email",
  "emailNormalized",
  "emailDomain",
  "phone",
  "addressLine",
  "city",
  "state",
  "postalCode",
  "countryCode",
  "regionCode",
  "businessType",
  "qualificationBasis",
  "evidenceUrl",
  "researchSourceRef",
] as const satisfies ReadonlyArray<keyof Candidate>;

export type BuiltRow = {
  candidate: Candidate | null;
  issues: RowIssue[];
  /** Row cannot be imported (invalid) or contains nothing (skipped). */
  disposition: "ok" | "invalid" | "skipped";
};

const err = (code: string, message: string, field?: string): RowIssue => ({
  code,
  field,
  severity: "error",
  message,
});
const warn = (code: string, message: string, field?: string): RowIssue => ({
  code,
  field,
  severity: "warning",
  message,
});
const info = (code: string, message: string, field?: string): RowIssue => ({
  code,
  field,
  severity: "info",
  message,
});

export function buildCandidate(
  cells: Record<string, string>,
  mapping: ColumnMapping,
  settings: ImportSettings,
  shapeProblems: readonly string[] = [],
  now: Date = new Date(),
): BuiltRow {
  const issues: RowIssue[] = [];
  const value: Partial<Record<string, string>> = {};
  const custom: Record<string, string> = {};

  for (const [header, target] of Object.entries(mapping)) {
    if (target === "ignore") continue;
    const v = cleanText(cells[header]);
    if (v === null) continue;
    if (target.startsWith("custom:")) custom[target.slice(7)] = v;
    else value[target] = v;
  }

  if (Object.keys(value).length === 0 && Object.keys(custom).length === 0) {
    return {
      candidate: null,
      issues: [info("BLANK_ROW", "The row has no values in mapped columns.")],
      disposition: "skipped",
    };
  }
  if (shapeProblems.length) {
    issues.push(
      err(
        "MALFORMED_ROW",
        `The row is malformed and its values may be in the wrong columns: ${shapeProblems.join(" ")}`,
      ),
    );
  }

  // Company (required).
  const companyName = value.company_name ?? null;
  if (!companyName)
    issues.push(err("MISSING_REQUIRED_FIELD", "Company name is required.", "company_name"));

  // Email.
  let email: string | null = null;
  let emailNormalized: string | null = null;
  let emailDomain: string | null = null;
  if (value.email) {
    const e = normalizeEmail(value.email);
    if (e.ok) {
      email = e.email;
      emailNormalized = e.normalized;
      emailDomain = e.domain;
    } else {
      issues.push(
        err(
          "INVALID_EMAIL",
          e.reason === "MULTIPLE_EMAILS"
            ? "The email cell contains more than one address."
            : `“${value.email}” is not a valid email address.`,
          "email",
        ),
      );
    }
  } else {
    issues.push(
      warn(
        "MISSING_EMAIL",
        "No email address — the prospect will be stored but cannot be contacted.",
        "email",
      ),
    );
  }

  // Website / domain.
  const site = normalizeWebsite(value.website);
  if (value.website && !site.valid) {
    issues.push(
      warn(
        "WEBSITE_UNPARSEABLE",
        "The website could not be read as a web address; it is kept as written.",
        "website",
      ),
    );
  }

  // Names.
  const contactName = value.contact_name ?? null;
  let firstName = value.first_name ?? null;
  let lastName = value.last_name ?? null;
  if (contactName && !firstName && !lastName) {
    const split = splitContactName(contactName);
    firstName = split.firstName;
    lastName = split.lastName;
  }
  const fullName = contactName ?? ([firstName, lastName].filter(Boolean).join(" ") || null);

  // Phone.
  const phone = normalizePhone(value.phone);
  if (phone.phone && !phone.plausible) {
    issues.push(
      warn("PHONE_UNUSUAL", "The phone number looks unusual; it is kept as written.", "phone"),
    );
  }

  // Evidence URL.
  const evidence = normalizeEvidenceUrl(value.evidence_url);
  if (evidence.url && !evidence.valid) {
    issues.push(
      warn(
        "EVIDENCE_URL_INVALID",
        "The evidence URL is not an http(s) link; it is kept as text and not linked.",
        "evidence_url",
      ),
    );
  }

  // Country & region — never assumed. The import default applies only to blank cells.
  let countryCode: string | null = null;
  if (value.country) {
    const c = normalizeCountry(value.country);
    if (c.code) countryCode = c.code;
    else
      issues.push(
        warn(
          "INVALID_COUNTRY",
          `“${value.country}” is not a recognized country, so it is left unknown.`,
          "country",
        ),
      );
  } else if (settings.defaultCountryCode) {
    countryCode = settings.defaultCountryCode;
    issues.push(
      info(
        "COUNTRY_DEFAULT_APPLIED",
        `No country in the file; the import default (${settings.defaultCountryCode}) was applied.`,
        "country",
      ),
    );
  } else {
    issues.push(
      warn("COUNTRY_MISSING", "No country — outreach eligibility will need review.", "country"),
    );
  }
  const state = value.state ?? null;
  const regionCode = normalizeRegion(state, countryCode);

  // Verification — only recognized labels with an unambiguous ISO date count.
  let verification = {
    status: "UNKNOWN" as EmailVerificationStatus,
    verifiedAt: null as Date | null,
    source: null as string | null,
    detail: null as string | null,
  };
  const hasVerificationInput = Boolean(value.verification_status || value.verified_at);
  if (hasVerificationInput && settings.verificationMode === "ignore") {
    issues.push(
      info(
        "VERIFICATION_IGNORED",
        "Verification columns were ignored by the import settings.",
        "verification_status",
      ),
    );
  } else if (value.verification_status) {
    const verifiedAt = parseIsoDate(value.verified_at);
    if (value.verified_at && !verifiedAt) {
      issues.push(
        warn(
          "VERIFIED_AT_UNPARSEABLE",
          `“${value.verified_at}” is not a YYYY-MM-DD date, so the verification result cannot be trusted.`,
          "verified_at",
        ),
      );
    }
    const record = buildVerificationRecord({
      label: value.verification_status,
      verifiedAt,
      source: value.verification_source ?? settings.verificationSourceLabel,
      now,
    });
    if (record.status === "UNKNOWN" && record.detail) {
      issues.push(
        warn(
          "VERIFICATION_NOT_TRUSTED",
          verifiedAt
            ? `The verification label “${value.verification_status}” is not recognized, so the email is treated as unverified.`
            : `The verification result “${value.verification_status}” has no usable date, so the email is treated as unverified.`,
          "verification_status",
        ),
      );
    }
    verification = {
      status: record.status,
      verifiedAt: record.verifiedAt,
      source: record.source,
      detail: record.detail,
    };
  }

  const candidate: Candidate = {
    companyName,
    website: site.website,
    websiteDomain: site.domain,
    contactName: fullName,
    firstName,
    lastName,
    contactTitle: value.contact_title ?? null,
    email,
    emailNormalized,
    emailDomain,
    phone: phone.phone,
    addressLine: value.address_line ?? null,
    city: value.city ?? null,
    state,
    postalCode: value.postal_code ?? null,
    countryCode,
    regionCode,
    businessType: value.business_type ?? settings.defaultBusinessType ?? null,
    qualificationBasis: value.qualification_basis ?? null,
    evidenceUrl: evidence.url,
    researchSourceRef: value.research_source_ref ?? null,
    verificationStatus: verification.status,
    verifiedAt: verification.verifiedAt,
    verificationSource: verification.source,
    verificationDetail: verification.detail,
    customFields: custom,
  };

  const invalid = issues.some((i) => i.severity === "error");
  return { candidate, issues, disposition: invalid ? "invalid" : "ok" };
}

/** Identity used to detect the same prospect: email → research ref → company/contact/domain. */
export function identityKeys(c: Candidate): {
  email: string | null;
  ref: string | null;
  fallback: string | null;
} {
  const fallback =
    !c.emailNormalized && !c.researchSourceRef && c.companyName
      ? [
          c.companyName.toLowerCase(),
          (c.contactName ?? "").toLowerCase(),
          c.websiteDomain ?? "",
        ].join("|")
      : null;
  return { email: c.emailNormalized, ref: c.researchSourceRef, fallback };
}

/** Existing prospect snapshot used for matching/merging. */
export type ExistingProspect = Candidate & { id: string };

export type MatchDecision = {
  outcome: Extract<
    ImportRowOutcome,
    "create" | "update" | "unchanged" | "duplicate_existing" | "invalid"
  >;
  existingId: string | null;
  /** The record as it will be stored (merged with the existing one for updates). */
  result: Candidate;
  changedFields: string[];
  issues: RowIssue[];
};

const sameValue = (a: unknown, b: unknown) =>
  a instanceof Date || b instanceof Date
    ? (a as Date | null)?.getTime() === (b as Date | null)?.getTime()
    : JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Merge rules: blank incoming cells never erase stored values; non-blank values replace them.
 * Verification is only replaced by a recognized, dated result that is at least as recent.
 */
export function mergeIntoExisting(
  existing: ExistingProspect,
  incoming: Candidate,
): { result: Candidate; changed: string[] } {
  const result: Candidate = { ...existing };
  const changed: string[] = [];
  for (const f of RESEARCH_FIELDS) {
    const v = incoming[f];
    if (v !== null && v !== undefined && !sameValue(v, existing[f])) {
      (result as Record<string, unknown>)[f] = v;
      changed.push(f);
    }
  }
  // Region code is derived — recompute from the merged state/country.
  const region = normalizeRegion(result.state, result.countryCode);
  if (!sameValue(region, existing.regionCode)) {
    result.regionCode = region;
    if (!changed.includes("regionCode")) changed.push("regionCode");
  }
  const incomingVerified = incoming.verificationStatus !== "UNKNOWN" && incoming.verifiedAt;
  const newer =
    !existing.verifiedAt ||
    (incoming.verifiedAt && incoming.verifiedAt.getTime() >= existing.verifiedAt.getTime());
  if (incomingVerified && newer) {
    const before = [
      existing.verificationStatus,
      existing.verifiedAt?.getTime(),
      existing.verificationSource,
    ];
    result.verificationStatus = incoming.verificationStatus;
    result.verifiedAt = incoming.verifiedAt;
    result.verificationSource = incoming.verificationSource;
    result.verificationDetail = incoming.verificationDetail;
    if (
      !sameValue(before, [
        incoming.verificationStatus,
        incoming.verifiedAt?.getTime(),
        incoming.verificationSource,
      ])
    ) {
      changed.push("verification");
    }
  }
  const mergedCustom = { ...existing.customFields, ...incoming.customFields };
  if (!sameValue(mergedCustom, existing.customFields)) {
    result.customFields = mergedCustom;
    changed.push("customFields");
  }
  return { result, changed };
}

export function decideMatch(
  incoming: Candidate,
  matches: {
    byEmail: ExistingProspect | null;
    byRef: ExistingProspect | null;
    byFallback: ExistingProspect | null;
  },
  settings: Pick<ImportSettings, "onExisting">,
): MatchDecision {
  const { byEmail, byRef, byFallback } = matches;
  if (byEmail && byRef && byEmail.id !== byRef.id) {
    return {
      outcome: "invalid",
      existingId: null,
      result: incoming,
      changedFields: [],
      issues: [
        err(
          "IDENTITY_CONFLICT",
          "The email matches one existing prospect but the LeadVault record ID matches a different one. Resolve this in the source data.",
        ),
      ],
    };
  }
  const existing = byEmail ?? byRef ?? byFallback;
  if (!existing)
    return { outcome: "create", existingId: null, result: incoming, changedFields: [], issues: [] };

  if (settings.onExisting === "skip") {
    return {
      outcome: "duplicate_existing",
      existingId: existing.id,
      result: existing,
      changedFields: [],
      issues: [
        info(
          "ALREADY_EXISTS",
          "This prospect already exists; the import settings skip existing prospects.",
        ),
      ],
    };
  }
  const { result, changed } = mergeIntoExisting(existing, incoming);
  return changed.length
    ? {
        outcome: "update",
        existingId: existing.id,
        result,
        changedFields: changed,
        issues: [info("UPDATED_FIELDS", `Updates: ${changed.join(", ")}.`)],
      }
    : {
        outcome: "unchanged",
        existingId: existing.id,
        result,
        changedFields: [],
        issues: [info("NO_CHANGES", "Already imported with identical values.")],
      };
}

/**
 * Marks rows that repeat an earlier row in the same file (by email, research ID, or — for rows
 * with neither — company/contact/domain). The FIRST occurrence wins; later ones are skipped.
 */
export function findInFileDuplicates(
  rows: ReadonlyArray<{ rowNumber: number; candidate: Candidate | null }>,
): Map<number, number> {
  const firstSeen = new Map<string, number>();
  const dupes = new Map<number, number>();
  for (const { rowNumber, candidate } of rows) {
    if (!candidate) continue;
    const k = identityKeys(candidate);
    const keys = [
      k.email && `e:${k.email}`,
      k.ref && `r:${k.ref}`,
      k.fallback && `f:${k.fallback}`,
    ].filter(Boolean) as string[];
    const earlier = keys.map((key) => firstSeen.get(key)).find((n) => n !== undefined);
    if (earlier !== undefined) {
      dupes.set(rowNumber, earlier);
      continue;
    }
    for (const key of keys) firstSeen.set(key, rowNumber);
  }
  return dupes;
}
