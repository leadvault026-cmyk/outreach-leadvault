import { Upload, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { ProspectFilterBar } from "@/components/prospects/filter-bar";
import { ProspectsBrowser } from "@/components/prospects/prospects-browser";
import { EmptyState } from "@/components/states/empty-state";
import { Button } from "@/components/ui/button";
import { systemDb, withUserContext } from "@/db/client";
import { ELIGIBILITY_LABELS } from "@/domain/eligibility";
import { can } from "@/domain/permissions";
import {
  hasActiveFilters,
  parseProspectFilters,
  prospectFiltersToQuery,
  PAGE_SIZES,
} from "@/domain/prospects/filters";
import { getPageContext } from "@/server/page-context";
import { refreshExpiredEligibility } from "@/services/eligibility-service";
import { listProspects, prospectFacets } from "@/services/prospect-query";

export const metadata: Metadata = { title: "Prospects" };

export default async function ProspectsPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/prospects">) {
  const ctx = await getPageContext(params);
  if (!ctx) return null;
  const filters = parseProspectFilters(await searchParams);
  const slug = ctx.workspace.slug;
  const base = `/w/${slug}/prospects`;

  // Decisions whose freshness window has passed are re-evaluated before they are shown.
  await refreshExpiredEligibility(systemDb(), ctx.workspace.id);
  const { list, facets } = await withUserContext(ctx.user.userId, async (tx) => ({
    list: await listProspects(tx, ctx.workspace.id, filters),
    facets: await prospectFacets(tx, ctx.workspace.id),
  }));

  const canManage = can(ctx.role, "prospects.manage");
  const totalAll = facets.countries.reduce((s, c) => s + c.n, 0);
  const byStatus = Object.fromEntries(facets.totals.map((t) => [t.e, t.n]));
  const filtered = hasActiveFilters(filters);
  // Only the filters (not paging or sorting) define "all matching" for bulk actions.
  const filterQuery = prospectFiltersToQuery(filters, {
    page: 1,
    size: 50,
    sort: "updated",
    dir: undefined,
  }).replace(/^\?/, "");

  if (totalAll === 0) {
    return (
      <>
        <PageHeader
          title="Prospects"
          description="The approved companies and contacts in this workspace."
        />
        <EmptyState
          icon={Users}
          title="No prospects yet"
          description="Prospects arrive through CSV imports of approved LeadVault research. Import a file to get started."
          className="bg-card"
          action={
            canManage ? (
              <Button asChild>
                <Link href={`/w/${slug}/imports/new`}>
                  <Upload /> Import prospects
                </Link>
              </Button>
            ) : undefined
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Prospects"
        description="Every prospect carries an eligibility decision with its reasons. Filter, select, and save groups as audiences."
        actions={
          canManage ? (
            <Button variant="outline" asChild>
              <Link href={`/w/${slug}/imports/new`}>
                <Upload /> Import
              </Link>
            </Button>
          ) : null
        }
      />

      <nav aria-label="Eligibility shortcuts" className="mb-3 flex flex-wrap gap-2 text-sm">
        {[
          { key: undefined, label: "All", n: totalAll },
          {
            key: "ELIGIBLE" as const,
            label: ELIGIBILITY_LABELS.ELIGIBLE,
            n: byStatus.ELIGIBLE ?? 0,
          },
          {
            key: "NEEDS_REVIEW" as const,
            label: ELIGIBILITY_LABELS.NEEDS_REVIEW,
            n: byStatus.NEEDS_REVIEW ?? 0,
          },
          {
            key: "INELIGIBLE" as const,
            label: ELIGIBILITY_LABELS.INELIGIBLE,
            n: byStatus.INELIGIBLE ?? 0,
          },
          {
            key: "SUPPRESSED" as const,
            label: ELIGIBILITY_LABELS.SUPPRESSED,
            n: byStatus.SUPPRESSED ?? 0,
          },
        ].map((s) => {
          const active = filters.eligibility === s.key;
          return (
            <Link
              key={s.label}
              href={`${base}${prospectFiltersToQuery(filters, { eligibility: s.key, page: 1 })}`}
              aria-current={active ? "page" : undefined}
              className={`tabular rounded-md border px-2.5 py-1 ${active ? "border-primary bg-primary/10 font-medium text-foreground" : "bg-card text-muted-foreground hover:text-foreground"}`}
            >
              {s.label} <span className="text-xs">{s.n.toLocaleString()}</span>
            </Link>
          );
        })}
      </nav>

      <ProspectFilterBar action={base} filters={filters} facets={facets} />

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <p className="tabular" aria-live="polite">
          {list.total.toLocaleString()} {list.total === 1 ? "prospect" : "prospects"}
          {filtered ? " match these filters" : ""}
        </p>
        <nav aria-label="Rows per page" className="flex items-center gap-1">
          Rows per page:
          {PAGE_SIZES.map((n) => (
            <Link
              key={n}
              href={`${base}${prospectFiltersToQuery(filters, { size: n, page: 1 })}`}
              aria-current={filters.size === n ? "true" : undefined}
              className={`rounded px-1.5 py-0.5 ${filters.size === n ? "bg-muted font-medium text-foreground" : "hover:text-foreground"}`}
            >
              {n}
            </Link>
          ))}
        </nav>
      </div>

      {list.rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No prospects match"
          description="Try removing a filter or searching for something else."
          className="bg-card"
          action={
            <Button variant="outline" asChild>
              <Link href={base}>Clear filters</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          <ProspectsBrowser
            workspaceSlug={slug}
            rows={list.rows}
            total={list.total}
            filters={filters}
            filterQuery={filterQuery}
            audiences={facets.audiences}
            canManage={can(ctx.role, "audiences.manage")}
          />
          <Pagination
            page={filters.page}
            size={filters.size}
            total={list.total}
            hrefFor={(p) => `${base}${prospectFiltersToQuery(filters, { page: p })}`}
          />
        </div>
      )}
    </>
  );
}
