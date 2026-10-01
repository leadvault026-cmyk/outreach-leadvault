/**
 * Import destinations and column-mapping rules (Phase 2 §F).
 * The LeadVault customer-delivery layout is first-class, but any CSV can be mapped.
 */

export const TARGET_FIELDS = [
  { key: "company_name", label: "Company name", group: "Company", required: true },
  { key: "website", label: "Website", group: "Company" },
  { key: "business_type", label: "Provider type / industry", group: "Company" },
  { key: "contact_name", label: "Contact name", group: "Contact" },
  { key: "first_name", label: "First name", group: "Contact" },
  { key: "last_name", label: "Last name", group: "Contact" },
  { key: "contact_title", label: "Contact title", group: "Contact" },
  { key: "email", label: "Email address", group: "Contact" },
  { key: "phone", label: "Phone number", group: "Contact" },
  { key: "address_line", label: "Address", group: "Location" },
  { key: "city", label: "City", group: "Location" },
  { key: "state", label: "State / region", group: "Location" },
  { key: "postal_code", label: "Postal code", group: "Location" },
  { key: "country", label: "Country", group: "Location" },
  { key: "qualification_basis", label: "Qualification basis", group: "Qualification" },
  { key: "evidence_url", label: "Evidence URL", group: "Qualification" },
  { key: "research_source_ref", label: "LeadVault record ID", group: "Research provenance" },
  { key: "verification_status", label: "Verification status", group: "Email verification" },
  { key: "verified_at", label: "Verified at (YYYY-MM-DD)", group: "Email verification" },
  { key: "verification_source", label: "Verification source", group: "Email verification" },
] as const;

export type TargetField = (typeof TARGET_FIELDS)[number]["key"];
export const TARGET_KEYS = new Set<string>(TARGET_FIELDS.map((f) => f.key));

/** A column maps to a core field, a workspace custom field, or is ignored. */
export type ColumnTarget = TargetField | `custom:${string}` | "ignore";
export type ColumnMapping = Record<string, ColumnTarget>;

export function targetLabel(target: string): string {
  if (target === "ignore") return "Ignored";
  if (target.startsWith("custom:")) return `Custom: ${target.slice(7)}`;
  return TARGET_FIELDS.find((f) => f.key === target)?.label ?? target;
}

function headerKey(header: string): string {
  return header
    .toLowerCase()
    .replace(/[_\-./]+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Exact-match synonyms only (after case/punctuation normalization). Anything not listed is left
 * unmapped for the operator to decide — we never fuzzy-guess.
 */
const SYNONYMS: Record<TargetField, string[]> = {
  company_name: [
    "company name",
    "company",
    "business name",
    "organization",
    "organisation",
    "practice name",
    "account name",
  ],
  website: [
    "website",
    "web site",
    "url",
    "company website",
    "website url",
    "domain",
    "company url",
  ],
  business_type: [
    "provider type",
    "industry",
    "business type",
    "category",
    "provider category",
    "specialty type",
  ],
  contact_name: [
    "contact name",
    "contact",
    "contact person",
    "full name",
    "name of contact",
    "decision maker",
  ],
  first_name: ["first name", "firstname", "given name"],
  last_name: ["last name", "lastname", "surname", "family name"],
  contact_title: ["contact title", "title", "job title", "role", "position"],
  email: ["email address", "email", "e mail", "business email", "work email", "contact email"],
  phone: [
    "phone number",
    "phone",
    "telephone",
    "tel",
    "phone no",
    "office phone",
    "business phone",
  ],
  address_line: ["address", "street address", "address line", "address 1", "street"],
  city: ["city", "town"],
  state: ["state", "region", "province", "state province", "county"],
  postal_code: ["postal code", "zip", "zip code", "postcode"],
  country: ["country", "country code"],
  qualification_basis: [
    "qualification basis",
    "qualification",
    "qualification reason",
    "why qualified",
  ],
  evidence_url: ["evidence url", "evidence", "source url", "evidence link"],
  research_source_ref: [
    "leadvault id",
    "leadvault record id",
    "record id",
    "research id",
    "research source ref",
  ],
  verification_status: [
    "verification status",
    "email status",
    "email verification",
    "verification",
  ],
  verified_at: ["verified at", "verification date", "verified on", "email verified at"],
  verification_source: ["verification source", "verified by"],
};

const SYNONYM_LOOKUP = new Map<string, TargetField>();
for (const [field, list] of Object.entries(SYNONYMS) as Array<[TargetField, string[]]>) {
  for (const s of list) SYNONYM_LOOKUP.set(s, field);
}

/**
 * Suggest a mapping. If two headers claim the same field (e.g. "Email" and "E-mail"), neither is
 * suggested and both are reported as ambiguous. Custom fields are suggested only on an exact key
 * match with an existing workspace custom field.
 */
export function suggestMapping(
  headers: readonly string[],
  customFieldKeys: readonly string[] = [],
): { mapping: ColumnMapping; ambiguous: string[] } {
  const proposals = new Map<string, ColumnTarget>();
  for (const h of headers) {
    const k = headerKey(h);
    const core = SYNONYM_LOOKUP.get(k);
    if (core) proposals.set(h, core);
    else {
      const custom = customFieldKeys.find((c) => c === k.replace(/ /g, "_"));
      if (custom) proposals.set(h, `custom:${custom}`);
    }
  }
  const counts = new Map<ColumnTarget, number>();
  for (const t of proposals.values()) counts.set(t, (counts.get(t) ?? 0) + 1);

  const mapping: ColumnMapping = {};
  const ambiguous: string[] = [];
  for (const h of headers) {
    const t = proposals.get(h);
    if (t && counts.get(t) === 1) mapping[h] = t;
    else {
      mapping[h] = "ignore";
      if (t) ambiguous.push(h);
    }
  }
  return { mapping, ambiguous };
}

export type MappingProblem = { code: string; message: string; columns?: string[] };

/** Server-side validation of an operator-supplied mapping. */
export function validateMapping(
  headers: readonly string[],
  mapping: Record<string, string>,
  allowedCustomKeys: readonly string[],
): { ok: true; mapping: ColumnMapping } | { ok: false; problems: MappingProblem[] } {
  const problems: MappingProblem[] = [];
  const clean: ColumnMapping = {};
  const used = new Map<string, string[]>();

  for (const h of headers) {
    const target = mapping[h] ?? "ignore";
    const isCore = TARGET_KEYS.has(target);
    const isCustom = target.startsWith("custom:") && allowedCustomKeys.includes(target.slice(7));
    if (target !== "ignore" && !isCore && !isCustom) {
      problems.push({
        code: "UNKNOWN_TARGET",
        message: `“${h}” is mapped to an unknown field.`,
        columns: [h],
      });
      continue;
    }
    clean[h] = target as ColumnTarget;
    if (target !== "ignore") used.set(target, [...(used.get(target) ?? []), h]);
  }
  for (const k of Object.keys(mapping)) {
    if (!headers.includes(k)) {
      problems.push({ code: "UNKNOWN_COLUMN", message: `“${k}” is not a column in this file.` });
    }
  }
  for (const [target, cols] of used) {
    if (cols.length > 1) {
      problems.push({
        code: "DUPLICATE_TARGET",
        message: `${cols.map((c) => `“${c}”`).join(" and ")} are all mapped to ${targetLabel(target)}. Each field can come from one column only.`,
        columns: cols,
      });
    }
  }
  if (![...used.keys()].includes("company_name")) {
    problems.push({
      code: "COMPANY_NOT_MAPPED",
      message: "Map a column to Company name — it is required.",
    });
  }
  return problems.length ? { ok: false, problems } : { ok: true, mapping: clean };
}

/** Header → custom-field key, e.g. "Practice Size (FTE)" → "practice_size_fte". */
export function customFieldKeyFromHeader(header: string): string | null {
  const key = headerKey(header)
    .replace(/ /g, "_")
    .replace(/^[^a-z]+/, "")
    .slice(0, 41);
  return /^[a-z][a-z0-9_]{1,40}$/.test(key) ? key : null;
}
