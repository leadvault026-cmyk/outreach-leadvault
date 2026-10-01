import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

/** Server-side pagination controls. Pages are links, so they work without JavaScript. */
export function Pagination({
  page,
  size,
  total,
  hrefFor,
}: {
  page: number;
  size: number;
  total: number;
  hrefFor: (page: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (total <= size) return null;
  const from = (page - 1) * size + 1;
  const to = Math.min(total, page * size);
  const btn =
    "inline-flex h-8 items-center gap-1 rounded-md border bg-card px-2.5 text-sm hover:bg-muted";
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3">
      <p className="tabular text-xs text-muted-foreground">
        Showing {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} className={btn} rel="prev">
            <ChevronLeft aria-hidden className="size-4" /> Previous
          </Link>
        ) : (
          <span className={`${btn} pointer-events-none opacity-50`} aria-disabled="true">
            <ChevronLeft aria-hidden className="size-4" /> Previous
          </span>
        )}
        <span className="tabular text-xs text-muted-foreground" aria-current="page">
          Page {page} of {pages.toLocaleString()}
        </span>
        {page < pages ? (
          <Link href={hrefFor(page + 1)} className={btn} rel="next">
            Next <ChevronRight aria-hidden className="size-4" />
          </Link>
        ) : (
          <span className={`${btn} pointer-events-none opacity-50`} aria-disabled="true">
            Next <ChevronRight aria-hidden className="size-4" />
          </span>
        )}
      </div>
    </nav>
  );
}
