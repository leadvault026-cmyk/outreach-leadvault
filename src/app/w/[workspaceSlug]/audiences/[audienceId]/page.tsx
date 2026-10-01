import { ArrowLeft, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AudienceFormDialog } from "@/components/audiences/audience-form-dialog";
import { AudienceMembers } from "@/components/audiences/audience-members";
import { Pagination } from "@/components/pagination";
import { ProspectFilterBar } from "@/components/prospects/filter-bar";
import { EmptyState } from "@/components/states/empty-state";
import { Button } from "@/components/ui/button";
import { systemDb, withUserContext } from "@/db/client";
import { ELIGIBILITY_LABELS } from "@/domain/eligibility";
import { can } from "@/domain/permissions";
import { parseProspectFilters, prospectFiltersToQuery } from "@/domain/prospects/filters";
import { isUuid } from "@/lib/ids";
import { formatDateTime } from "@/lib/format";
import { getPageContext } from "@/server/page-context";
import { getAudience } from "@/services/audience-service";
import { refreshExpiredEligibility } from "@/services/eligibility-service";
import { listProspects, prospectFacets } from "@/services/prospect-query";

export const metadata: Metadata = { title: "Audience" };

export default async function AudienceDetailPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/audiences/[audienceId]">) {
  const ctx = await getPageContext(params);
  if (!ctx) return null;
  const { audienceId } = await params;
  if (!isUuid(audienceId)) notFound();
  const slug = ctx.workspace.slug;
  const base = `/w/${slug}/audiences/${audienceId}`;
  // The audience filter is fixed by the URL path, never by the query string.
  const filters = {
    ...parseProspectFilters(await searchParams),
    audience: audienceId.toLowerCase(),
  };

  await refreshExpiredEligibility(systemDb(), ctx.workspace.id);
  const data = await withUserContext(ctx.user.userId, async (tx) => {
    const found = await getAudience(tx, ctx.workspace.id, audienceId);
    if (!found) return null;
    return {
      ...found,
      list: await listProspects(tx, ctx.workspace.id, filters),
      facets: await prospectFacets(tx, ctx.workspace.id),
    };
  });
  if (!data) notFound();
  const { audience, counts, list, facets } = data;
  const canManage = can(ctx.role, "audiences.manage");
  // Links on this page keep the audience in the path, not the query string.
  const queryFilters = { ...filters, audience: undefined };
  const tiles = [
    { label: "Members", value: counts.total },
    { label: ELIGIBILITY_LABELS.ELIGIBLE, value: counts.ELIGIBLE },
    { label: ELIGIBILITY_LABELS.NEEDS_REVIEW, value: counts.NEEDS_REVIEW },
    { label: ELIGIBILITY_LABELS.INELIGIBLE, value: counts.INELIGIBLE + counts.unknown },
    { label: ELIGIBILITY_LABELS.SUPPRESSED, value: counts.SUPPRESSED },
  ];

  return (
    <>
      <Link
        href={`/w/${slug}/audiences`}
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" /> Audiences
      </Link>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-[22px] leading-tight font-semibold tracking-tight break-words">
            {audience.name}
          </h1>
          {audience.description ? (
            <p className="mt-1.5 max-w-3xl text-sm text-muted-foreground">{audience.description}</p>
          ) : null}
          <p className="mt-1 text-xs text-muted-foreground">
            Created {formatDateTime(audience.createdAt, ctx.workspace.defaultTimezone)}
          </p>
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <AudienceFormDialog
              workspaceSlug={slug}
              audienceId={audience.id}
              initial={{ name: audience.name, description: audience.description }}
            />
            <Button size="sm" asChild>
              <Link href={`/w/${slug}/prospects`}>Add prospects</Link>
            </Button>
          </div>
        ) : null}
      </div>

      <section
        aria-label="Eligibility summary"
        className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5"
      >
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg border bg-card px-3 py-2.5">
            <p className="text-xs text-muted-foreground">{t.label}</p>
            <p className="tabular mt-0.5 text-lg font-semibold">{t.value.toLocaleString()}</p>
          </div>
        ))}
      </section>
      <p className="mb-4 text-xs text-muted-foreground">
        Only eligible members can be contacted by a future campaign. Every member is re-checked at
        launch; suppression always wins.
      </p>

      {counts.total === 0 ? (
        <EmptyState
          icon={Users}
          title="This audience is empty"
          description="Go to Prospects, filter and select the prospects you want, then choose “Add to audience”."
          className="bg-card"
        />
      ) : (
        <>
          <ProspectFilterBar
            action={base}
            filters={filters}
            facets={facets}
            hidden={["audience"]}
          />
          {list.rows.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No members match"
              description="Try removing a filter."
              className="bg-card"
              action={
                <Button variant="outline" asChild>
                  <Link href={base}>Clear filters</Link>
                </Button>
              }
            />
          ) : (
            <div className="space-y-4">
              <AudienceMembers
                workspaceSlug={slug}
                audienceId={audience.id}
                rows={list.rows}
                total={list.total}
                filters={queryFilters}
                canManage={canManage}
              />
              <Pagination
                page={filters.page}
                size={filters.size}
                total={list.total}
                hrefFor={(p) => `${base}${prospectFiltersToQuery(queryFilters, { page: p })}`}
              />
            </div>
          )}
        </>
      )}
    </>
  );
}
