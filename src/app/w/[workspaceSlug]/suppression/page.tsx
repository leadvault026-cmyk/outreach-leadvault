import { ShieldBan } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Pagination } from "@/components/pagination";
import { PageHeader } from "@/components/page-header";
import { selectClass } from "@/components/prospects/filter-bar";
import { EmptyState } from "@/components/states/empty-state";
import { StatusBadge } from "@/components/status-badge";
import {
  AddSuppressionDialog,
  LiftSuppressionDialog,
} from "@/components/suppression/suppression-dialogs";
import { Button } from "@/components/ui/button";
import { withUserContext } from "@/db/client";
import { SUPPRESSION_REASONS } from "@/domain/enums";
import { can, canManageGlobalSuppression } from "@/domain/permissions";
import { SUPPRESSION_REASON_LABELS, SUPPRESSION_SOURCE_LABELS } from "@/domain/suppression";
import { formatDateTime } from "@/lib/format";
import { getPageContext } from "@/server/page-context";
import { getMyProfile } from "@/server/profile";
import { listSuppressions, type SuppressionFilters } from "@/services/suppression-service";

export const metadata: Metadata = { title: "Suppression" };

const PAGE_SIZE = 50;

function first(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function parseFilters(sp: Record<string, string | string[] | undefined>): SuppressionFilters {
  const scope = first(sp.scope);
  const status = first(sp.status);
  const reason = first(sp.reason);
  const page = Number(first(sp.page));
  return {
    q: first(sp.q)?.trim().slice(0, 100) || undefined,
    scope: scope === "workspace" || scope === "global" ? scope : undefined,
    // Active entries by default; "all" shows active and lifted together.
    status: status === "lifted" ? "lifted" : status === "all" ? undefined : "active",
    reason:
      reason && (SUPPRESSION_REASONS as readonly string[]).includes(reason) ? reason : undefined,
    page: Number.isInteger(page) && page > 0 && page <= 10_000 ? page : 1,
    size: PAGE_SIZE,
  };
}

function toQuery(f: SuppressionFilters, page: number) {
  const qs = new URLSearchParams();
  if (f.q) qs.set("q", f.q);
  if (f.scope) qs.set("scope", f.scope);
  if (f.status !== "active") qs.set("status", f.status ?? "all");
  if (f.reason) qs.set("reason", f.reason);
  if (page > 1) qs.set("page", String(page));
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export default async function SuppressionPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/suppression">) {
  const ctx = await getPageContext(params);
  if (!ctx) return null;
  const slug = ctx.workspace.slug;
  const tz = ctx.workspace.defaultTimezone;
  const base = `/w/${slug}/suppression`;
  const filters = parseFilters(await searchParams);
  const { total, rows } = await withUserContext(ctx.user.userId, (tx) =>
    listSuppressions(tx, ctx.workspace.id, filters),
  );
  const isPlatformAdmin = canManageGlobalSuppression(await getMyProfile());
  const canAdd = can(ctx.role, "suppression.add");
  const canLift = can(ctx.role, "suppression.lift");
  const canLiftRow = (scope: string) => (scope === "global" ? isPlatformAdmin && canLift : canLift);

  return (
    <>
      <PageHeader
        title="Suppression"
        description="Email addresses and domains that must never be contacted. Suppression always overrides audiences and campaigns. Entries are never deleted — lifting one keeps the full history."
        actions={
          canAdd ? <AddSuppressionDialog workspaceSlug={slug} canGlobal={isPlatformAdmin} /> : null
        }
      />

      <form
        method="get"
        action={base}
        role="search"
        aria-label="Filter suppressions"
        className="mb-4 rounded-lg border bg-card p-3"
      >
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto]">
          <div className="sm:col-span-2 lg:col-span-1">
            <label htmlFor="sf-q" className="sr-only">
              Search email or domain
            </label>
            <input
              id="sf-q"
              name="q"
              type="search"
              defaultValue={filters.q ?? ""}
              placeholder="Search email or domain…"
              maxLength={100}
              className={selectClass}
            />
          </div>
          <div>
            <label htmlFor="sf-status" className="sr-only">
              Status
            </label>
            <select
              id="sf-status"
              name="status"
              defaultValue={filters.status === "active" ? "" : (filters.status ?? "all")}
              className={selectClass}
            >
              <option value="">Active</option>
              <option value="lifted">Lifted</option>
              <option value="all">All</option>
            </select>
          </div>
          <div>
            <label htmlFor="sf-scope" className="sr-only">
              Scope
            </label>
            <select
              id="sf-scope"
              name="scope"
              defaultValue={filters.scope ?? ""}
              className={selectClass}
            >
              <option value="">Any scope</option>
              <option value="workspace">This workspace</option>
              <option value="global">LeadVault-wide</option>
            </select>
          </div>
          <div>
            <label htmlFor="sf-reason" className="sr-only">
              Reason
            </label>
            <select
              id="sf-reason"
              name="reason"
              defaultValue={filters.reason ?? ""}
              className={selectClass}
            >
              <option value="">Any reason</option>
              {SUPPRESSION_REASONS.map((r) => (
                <option key={r} value={r}>
                  {SUPPRESSION_REASON_LABELS[r] ?? r}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
            <Button type="submit" className="flex-1 lg:flex-none">
              Apply
            </Button>
            <Button variant="outline" asChild className="flex-1 lg:flex-none">
              <Link href={base}>Clear</Link>
            </Button>
          </div>
        </div>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          icon={ShieldBan}
          title={
            filters.q || filters.scope || filters.reason || filters.status !== "active"
              ? "Nothing matches"
              : "No active suppressions"
          }
          description="Addresses and domains added here are excluded from every audience and campaign."
          className="bg-card"
        />
      ) : (
        <div className="space-y-4">
          <p className="tabular text-xs text-muted-foreground">{total.toLocaleString()} entries</p>
          <div className="overflow-hidden rounded-lg border bg-card">
            <table className="hidden w-full text-sm lg:table">
              <caption className="sr-only">Suppressions</caption>
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-4 py-2 font-medium">
                    Email or domain
                  </th>
                  <th scope="col" className="px-2 py-2 font-medium">
                    Scope
                  </th>
                  <th scope="col" className="px-2 py-2 font-medium">
                    Reason
                  </th>
                  <th scope="col" className="px-2 py-2 font-medium">
                    Added
                  </th>
                  <th scope="col" className="px-2 py-2 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-2 py-2 pr-4 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b align-top last:border-0">
                    <td className="max-w-xs px-4 py-2.5">
                      <p className="font-medium break-all">{r.value}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.valueType === "email" ? "Email address" : "Whole domain"}
                      </p>
                    </td>
                    <td className="px-2 py-2.5 whitespace-nowrap">
                      {r.scope === "global" ? "LeadVault-wide" : "Workspace"}
                    </td>
                    <td className="max-w-xs px-2 py-2.5">
                      <p>{SUPPRESSION_REASON_LABELS[r.reason] ?? r.reason}</p>
                      {r.note && (r.scope === "workspace" || isPlatformAdmin) ? (
                        <p className="line-clamp-2 text-xs text-muted-foreground" title={r.note}>
                          {r.note}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-2 py-2.5 text-xs whitespace-nowrap text-muted-foreground">
                      {formatDateTime(r.createdAt, tz)}
                      <br />
                      {SUPPRESSION_SOURCE_LABELS[r.source] ?? r.source}
                      {r.createdByEmail ? ` · ${r.createdByEmail}` : ""}
                    </td>
                    <td className="max-w-xs px-2 py-2.5">
                      {r.liftedAt ? (
                        <>
                          <StatusBadge status="lifted" tone="neutral" label="Lifted" />
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatDateTime(r.liftedAt, tz)}
                            {r.liftedByEmail ? ` · ${r.liftedByEmail}` : ""}
                          </p>
                          {r.liftReason && (r.scope === "workspace" || isPlatformAdmin) ? (
                            <p
                              className="line-clamp-2 text-xs text-muted-foreground"
                              title={r.liftReason}
                            >
                              {r.liftReason}
                            </p>
                          ) : null}
                        </>
                      ) : (
                        <StatusBadge status="SUPPRESSED" label="Active" />
                      )}
                    </td>
                    <td className="px-2 py-2.5 pr-4 text-right">
                      {!r.liftedAt && canLiftRow(r.scope) ? (
                        <LiftSuppressionDialog
                          workspaceSlug={slug}
                          suppressionId={r.id}
                          value={r.value}
                          global={r.scope === "global"}
                        />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y lg:hidden" aria-label="Suppressions">
              {rows.map((r) => (
                <li key={r.id} className="space-y-1 px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="min-w-0 font-medium break-all">{r.value}</p>
                    {r.liftedAt ? (
                      <StatusBadge status="lifted" tone="neutral" label="Lifted" />
                    ) : (
                      <StatusBadge status="SUPPRESSED" label="Active" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {r.valueType === "email" ? "Email" : "Domain"} ·{" "}
                    {r.scope === "global" ? "LeadVault-wide" : "Workspace"} ·{" "}
                    {SUPPRESSION_REASON_LABELS[r.reason] ?? r.reason} ·{" "}
                    {formatDateTime(r.createdAt, tz)}
                  </p>
                  {!r.liftedAt && canLiftRow(r.scope) ? (
                    <div className="pt-1">
                      <LiftSuppressionDialog
                        workspaceSlug={slug}
                        suppressionId={r.id}
                        value={r.value}
                        global={r.scope === "global"}
                      />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
          <Pagination
            page={filters.page}
            size={PAGE_SIZE}
            total={total}
            hrefFor={(p) => `${base}${toQuery(filters, p)}`}
          />
        </div>
      )}
    </>
  );
}
