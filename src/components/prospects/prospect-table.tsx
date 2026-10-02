"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import type { EligibilityStatus, EmailVerificationStatus } from "@/domain/enums";
import { reasonLabel } from "@/domain/eligibility";
import { prospectFiltersToQuery, type ProspectFilters } from "@/domain/prospects/filters";
import { relativeTime } from "@/lib/format";
import { EligibilityBadge, VerificationBadge } from "./badges";

export type ProspectRow = {
  id: string;
  companyName: string;
  websiteDomain: string | null;
  contactName: string | null;
  contactTitle: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  countryCode: string | null;
  businessType: string | null;
  verificationStatus: EmailVerificationStatus;
  verifiedAt: Date | null;
  updatedAt: Date;
  eligibility: EligibilityStatus | null;
  reasons: string[] | null;
};

/** What the bulk bar acts on: explicit ids, or every prospect matching the current filters. */
export type TableSelection = { mode: "ids"; ids: string[] } | { mode: "filter"; count: number };

type SortKey = ProspectFilters["sort"];

function location(r: ProspectRow) {
  return [r.city, r.state, r.countryCode].filter(Boolean).join(", ") || "—";
}

function SortHeader({
  label,
  sortKey,
  filters,
  basePath,
  className,
}: {
  label: string;
  sortKey: SortKey;
  filters: ProspectFilters;
  basePath: string;
  className?: string;
}) {
  const active = filters.sort === sortKey;
  const currentDir = filters.dir ?? (filters.sort === "updated" ? "desc" : "asc");
  const nextDir = active
    ? currentDir === "asc"
      ? "desc"
      : "asc"
    : sortKey === "updated"
      ? "desc"
      : "asc";
  const href = `${basePath}${prospectFiltersToQuery(filters, { sort: sortKey, dir: nextDir, page: 1 })}`;
  const Icon = !active ? ArrowUpDown : currentDir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      className={className}
      aria-sort={active ? (currentDir === "asc" ? "ascending" : "descending") : undefined}
    >
      <Link href={href} className="inline-flex items-center gap-1 hover:text-foreground">
        {label}
        <Icon aria-hidden className={`size-3 ${active ? "" : "opacity-40"}`} />
      </Link>
    </th>
  );
}

function Reasons({ reasons }: { reasons: string[] | null }) {
  if (!reasons?.length) return null;
  const [first, ...rest] = reasons;
  return (
    <p
      className="mt-1 truncate text-xs text-muted-foreground"
      title={reasons.map(reasonLabel).join(" · ")}
    >
      {reasonLabel(first!)}
      {rest.length ? ` +${rest.length}` : ""}
    </p>
  );
}

export function ProspectTable({
  rows,
  total,
  filters,
  basePath,
  detailBase,
  selectable,
  allowSelectAllMatching = true,
  renderBulk,
}: {
  rows: ProspectRow[];
  total: number;
  filters: ProspectFilters;
  basePath: string;
  detailBase: string;
  selectable: boolean;
  allowSelectAllMatching?: boolean;
  renderBulk?: (selection: TableSelection, clear: () => void) => ReactNode;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const pageIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const pageSelected = pageIds.filter((id) => selected.has(id)).length;
  const headerState: boolean | "indeterminate" =
    allMatching || (pageSelected > 0 && pageSelected === pageIds.length)
      ? true
      : pageSelected > 0
        ? "indeterminate"
        : false;

  const clear = () => {
    setSelected(new Set());
    setAllMatching(false);
  };
  const toggle = (id: string, on: boolean) => {
    setAllMatching(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const togglePage = (on: boolean) => {
    setAllMatching(false);
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of pageIds) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const selection: TableSelection | null = allMatching
    ? { mode: "filter", count: total }
    : selected.size
      ? { mode: "ids", ids: [...selected] }
      : null;
  const selectedCount = allMatching ? total : selected.size;

  const th = "px-2 py-2 font-medium";
  return (
    <div className="space-y-3">
      {selectable && selection ? (
        <div
          role="region"
          aria-label="Bulk actions"
          className="sticky top-14 z-10 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-card px-3 py-2 shadow-sm"
        >
          <p className="tabular text-sm font-medium" aria-live="polite">
            {selectedCount.toLocaleString()} selected
          </p>
          {allowSelectAllMatching &&
          !allMatching &&
          pageSelected === pageIds.length &&
          total > pageIds.length ? (
            <button
              type="button"
              className="text-sm text-primary underline-offset-4 hover:underline"
              onClick={() => setAllMatching(true)}
            >
              Select all {total.toLocaleString()} matching
            </button>
          ) : null}
          <button
            type="button"
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            onClick={clear}
          >
            Clear selection
          </button>
          <div className="ml-auto flex flex-wrap gap-2">{renderBulk?.(selection, clear)}</div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="hidden w-full table-fixed text-sm lg:table">
          <caption className="sr-only">Prospects</caption>
          <thead>
            <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
              {selectable ? (
                <th scope="col" className="w-10 px-3 py-2">
                  <Checkbox
                    aria-label="Select all prospects on this page"
                    checked={headerState}
                    onCheckedChange={(v) => togglePage(v === true)}
                  />
                </th>
              ) : null}
              <SortHeader
                label="Company"
                sortKey="company"
                filters={filters}
                basePath={basePath}
                className={`${th} w-[24%] ${selectable ? "" : "pl-4"}`}
              />
              <SortHeader
                label="Contact"
                sortKey="contact"
                filters={filters}
                basePath={basePath}
                className={`${th} w-[18%]`}
              />
              <th scope="col" className={`${th} w-[20%]`}>
                Email
              </th>
              <SortHeader
                label="Location"
                sortKey="location"
                filters={filters}
                basePath={basePath}
                className={`${th} w-[13%]`}
              />
              <th scope="col" className={`${th} w-[10%]`}>
                Verification
              </th>
              <SortHeader
                label="Eligibility"
                sortKey="eligibility"
                filters={filters}
                basePath={basePath}
                className={`${th} w-[15%]`}
              />
              <SortHeader
                label="Updated"
                sortKey="updated"
                filters={filters}
                basePath={basePath}
                className={`${th} w-[9%] pr-4`}
              />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className="border-b align-top last:border-0 hover:bg-muted/40 data-[selected=true]:bg-primary/5"
                data-selected={allMatching || selected.has(r.id)}
              >
                {selectable ? (
                  <td className="px-3 py-2.5">
                    <Checkbox
                      aria-label={`Select ${r.companyName}`}
                      checked={allMatching || selected.has(r.id)}
                      onCheckedChange={(v) => toggle(r.id, v === true)}
                    />
                  </td>
                ) : null}
                <td className={`px-2 py-2.5 ${selectable ? "" : "pl-4"}`}>
                  <Link
                    href={`${detailBase}/${r.id}`}
                    className="block truncate font-medium hover:underline"
                  >
                    {r.companyName}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {[r.websiteDomain, r.businessType].filter(Boolean).join(" · ") || "—"}
                  </p>
                </td>
                <td className="px-2 py-2.5">
                  <p className="truncate">
                    {r.contactName ?? <span className="text-muted-foreground">—</span>}
                  </p>
                  {r.contactTitle ? (
                    <p className="truncate text-xs text-muted-foreground">{r.contactTitle}</p>
                  ) : null}
                </td>
                <td className="truncate px-2 py-2.5" title={r.email ?? undefined}>
                  {r.email ?? <span className="text-muted-foreground">No email</span>}
                </td>
                <td className="truncate px-2 py-2.5">{location(r)}</td>
                <td className="px-2 py-2.5">
                  <VerificationBadge status={r.verificationStatus} verifiedAt={r.verifiedAt} />
                </td>
                <td className="px-2 py-2.5">
                  <EligibilityBadge status={r.eligibility} />
                  <Reasons reasons={r.reasons} />
                </td>
                <td className="px-2 py-2.5 pr-4 text-xs whitespace-nowrap text-muted-foreground">
                  {/* "5 seconds ago" can differ between server render and hydration. */}
                  <time dateTime={new Date(r.updatedAt).toISOString()} suppressHydrationWarning>
                    {relativeTime(new Date(r.updatedAt))}
                  </time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <ul className="divide-y lg:hidden" aria-label="Prospects">
          {selectable ? (
            <li className="flex items-center gap-3 bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              <Checkbox
                aria-label="Select all prospects on this page"
                checked={headerState}
                onCheckedChange={(v) => togglePage(v === true)}
              />
              Select page
            </li>
          ) : null}
          {rows.map((r) => (
            <li key={r.id} className="flex gap-3 px-3 py-3">
              {selectable ? (
                <Checkbox
                  className="mt-1"
                  aria-label={`Select ${r.companyName}`}
                  checked={allMatching || selected.has(r.id)}
                  onCheckedChange={(v) => toggle(r.id, v === true)}
                />
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <Link
                    href={`${detailBase}/${r.id}`}
                    className="min-w-0 font-medium break-words hover:underline"
                  >
                    {r.companyName}
                  </Link>
                  <EligibilityBadge status={r.eligibility} />
                </div>
                <p className="mt-0.5 text-sm break-words">
                  {[r.contactName, r.contactTitle].filter(Boolean).join(" — ") || (
                    <span className="text-muted-foreground">No contact name</span>
                  )}
                </p>
                <p className="text-sm break-all text-muted-foreground">{r.email ?? "No email"}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{location(r)}</span>
                  <VerificationBadge status={r.verificationStatus} verifiedAt={r.verifiedAt} />
                </div>
                <Reasons reasons={r.reasons} />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
