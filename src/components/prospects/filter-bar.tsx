import { Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ELIGIBILITY_STATUSES, EMAIL_VERIFICATION_STATUSES } from "@/domain/enums";
import { ELIGIBILITY_LABELS } from "@/domain/eligibility";
import { countryName, regionName } from "@/domain/geo";
import { HAS_FILTERS, type ProspectFilters } from "@/domain/prospects/filters";
import { VERIFICATION_LABELS } from "./badges";

const HAS_LABELS: Record<(typeof HAS_FILTERS)[number], string> = {
  email: "Has email",
  contact: "Has contact name",
  title: "Has job title",
  phone: "Has phone",
  evidence: "Has evidence link",
};

export const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export type Facets = {
  countries: Array<{ code: string | null; n: number }>;
  types: Array<{ type: string | null; n: number }>;
  regions: Array<{ region: string | null; n: number }>;
  imports: Array<{ id: string; label: string | null; createdAt: Date }>;
  audiences: Array<{ id: string; name: string }>;
};

/**
 * Prospect filters as a plain GET form: the URL is the state, so filtered views can be
 * bookmarked and shared, and the page works without JavaScript.
 */
export function ProspectFilterBar({
  action,
  filters,
  facets,
  hidden = [],
}: {
  action: string;
  filters: ProspectFilters;
  facets: Facets;
  /** Filters fixed by the page (e.g. the audience on an audience page) are not shown. */
  hidden?: Array<"audience" | "import">;
}) {
  const moreActive = Boolean(
    filters.region ||
    filters.type ||
    filters.has.length ||
    (filters.import && !hidden.includes("import")) ||
    (filters.audience && !hidden.includes("audience")),
  );
  return (
    <form
      method="get"
      action={action}
      role="search"
      aria-label="Filter prospects"
      className="mb-4 rounded-lg border bg-card p-3"
    >
      <input type="hidden" name="sort" value={filters.sort} />
      {filters.dir ? <input type="hidden" name="dir" value={filters.dir} /> : null}
      {filters.size !== 50 ? <input type="hidden" name="size" value={filters.size} /> : null}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto]">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <label htmlFor="pf-q" className="sr-only">
            Search prospects
          </label>
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            id="pf-q"
            name="q"
            type="search"
            defaultValue={filters.q ?? ""}
            placeholder="Company, contact, email, domain, city…"
            maxLength={100}
            className={`${selectClass} pl-8`}
          />
        </div>
        <div>
          <label htmlFor="pf-eligibility" className="sr-only">
            Eligibility
          </label>
          <select
            id="pf-eligibility"
            name="eligibility"
            defaultValue={filters.eligibility ?? ""}
            className={selectClass}
          >
            <option value="">Any eligibility</option>
            {ELIGIBILITY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ELIGIBILITY_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="pf-verification" className="sr-only">
            Email verification
          </label>
          <select
            id="pf-verification"
            name="verification"
            defaultValue={filters.verification ?? ""}
            className={selectClass}
          >
            <option value="">Any verification</option>
            {EMAIL_VERIFICATION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {VERIFICATION_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="pf-country" className="sr-only">
            Country
          </label>
          <select
            id="pf-country"
            name="country"
            defaultValue={filters.country ?? ""}
            className={selectClass}
          >
            <option value="">Any country</option>
            {facets.countries.map((c) =>
              c.code ? (
                <option key={c.code} value={c.code}>
                  {countryName(c.code) ?? c.code} ({c.n.toLocaleString()})
                </option>
              ) : (
                <option key="none" value="none">
                  Country unknown ({c.n.toLocaleString()})
                </option>
              ),
            )}
          </select>
        </div>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
          <Button type="submit" className="flex-1 lg:flex-none">
            Apply
          </Button>
          <Button variant="outline" asChild className="flex-1 lg:flex-none">
            <Link href={action}>Clear</Link>
          </Button>
        </div>
      </div>
      <details className="group mt-2" open={moreActive}>
        <summary className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-1 py-1 text-xs font-medium text-muted-foreground hover:text-foreground">
          <SlidersHorizontal aria-hidden className="size-3.5" /> More filters
        </summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="pf-region" className="mb-1 block text-xs text-muted-foreground">
              State / region
            </label>
            <select
              id="pf-region"
              name="region"
              defaultValue={filters.region ?? ""}
              className={selectClass}
            >
              <option value="">Any region</option>
              {facets.regions.map((r) =>
                r.region ? (
                  <option key={r.region} value={r.region}>
                    {regionName(r.region) ?? r.region} ({r.n.toLocaleString()})
                  </option>
                ) : null,
              )}
            </select>
          </div>
          <div>
            <label htmlFor="pf-type" className="mb-1 block text-xs text-muted-foreground">
              Business type
            </label>
            <select
              id="pf-type"
              name="type"
              defaultValue={filters.type ?? ""}
              className={selectClass}
            >
              <option value="">Any type</option>
              {facets.types.map((t) =>
                t.type ? (
                  <option key={t.type} value={t.type}>
                    {t.type} ({t.n.toLocaleString()})
                  </option>
                ) : null,
              )}
            </select>
          </div>
          {!hidden.includes("import") ? (
            <div>
              <label htmlFor="pf-import" className="mb-1 block text-xs text-muted-foreground">
                Import
              </label>
              <select
                id="pf-import"
                name="import"
                defaultValue={filters.import ?? ""}
                className={selectClass}
              >
                <option value="">Any import</option>
                {facets.imports.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.label ?? "Untitled import"}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {!hidden.includes("audience") ? (
            <div>
              <label htmlFor="pf-audience" className="mb-1 block text-xs text-muted-foreground">
                Audience
              </label>
              <select
                id="pf-audience"
                name="audience"
                defaultValue={filters.audience ?? ""}
                className={selectClass}
              >
                <option value="">Any audience</option>
                {facets.audiences.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <fieldset className="sm:col-span-2 lg:col-span-4">
            <legend className="mb-1 text-xs text-muted-foreground">Data completeness</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {HAS_FILTERS.map((h) => (
                <label key={h} className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="has"
                    value={h}
                    defaultChecked={filters.has.includes(h)}
                    className="size-4 accent-primary"
                  />
                  {HAS_LABELS[h]}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </details>
    </form>
  );
}
