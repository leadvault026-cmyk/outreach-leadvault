import { z } from "zod";
import { ELIGIBILITY_STATUSES, EMAIL_VERIFICATION_STATUSES } from "../enums";

/**
 * Prospect list query, parsed from URL search params. One definition is shared by the list page,
 * "select all matching" bulk actions and audience creation, so they always agree.
 */
export const PROSPECT_SORTS = ["updated", "company", "contact", "location", "eligibility"] as const;
export const HAS_FILTERS = ["contact", "title", "phone", "evidence", "email"] as const;
export const PAGE_SIZES = [25, 50, 100] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

const uuidOrUndefined = z
  .string()
  .optional()
  .transform((v) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v.toLowerCase() : undefined));

export const prospectFilterSchema = z.object({
  q: optionalText(100),
  eligibility: z.enum(ELIGIBILITY_STATUSES).optional().catch(undefined),
  verification: z.enum(EMAIL_VERIFICATION_STATUSES).optional().catch(undefined),
  country: z
    .string()
    .optional()
    .transform((v) =>
      v && /^[A-Za-z]{2}$/.test(v) ? v.toUpperCase() : v === "none" ? "none" : undefined,
    ),
  region: optionalText(80),
  type: optionalText(120),
  has: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) =>
      (Array.isArray(v) ? v : v ? [v] : []).filter((x): x is (typeof HAS_FILTERS)[number] =>
        (HAS_FILTERS as readonly string[]).includes(x),
      ),
    ),
  import: uuidOrUndefined,
  audience: uuidOrUndefined,
  sort: z
    .enum(PROSPECT_SORTS)
    .optional()
    .catch(undefined)
    .transform((v) => v ?? "updated"),
  dir: z.enum(["asc", "desc"]).optional().catch(undefined),
  page: z.coerce
    .number()
    .int()
    .min(1)
    .max(10_000)
    .optional()
    .catch(undefined)
    .transform((v) => v ?? 1),
  size: z.coerce
    .number()
    .optional()
    .catch(undefined)
    .transform((v) => ((PAGE_SIZES as readonly number[]).includes(v ?? 0) ? (v as number) : 50)),
});

export type ProspectFilters = z.output<typeof prospectFilterSchema>;

export function parseProspectFilters(
  params: Record<string, string | string[] | undefined>,
): ProspectFilters {
  const flat: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params))
    flat[k] = k === "has" ? v : Array.isArray(v) ? v[0] : v;
  return prospectFilterSchema.parse(flat);
}

/** Serialize filters back to a query string (omitting defaults). */
export function prospectFiltersToQuery(
  f: Partial<ProspectFilters>,
  overrides: Partial<ProspectFilters> = {},
): string {
  const merged = { ...f, ...overrides };
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v === undefined || v === null || v === "") continue;
    if (k === "page" && v === 1) continue;
    if (k === "size" && v === 50) continue;
    if (k === "sort" && v === "updated") continue;
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, String(x)));
    else qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export function hasActiveFilters(f: ProspectFilters): boolean {
  return Boolean(
    f.q ||
    f.eligibility ||
    f.verification ||
    f.country ||
    f.region ||
    f.type ||
    f.has.length ||
    f.import ||
    f.audience,
  );
}
