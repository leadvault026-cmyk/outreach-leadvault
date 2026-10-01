import { Skeleton } from "@/components/ui/skeleton";

/** Route-level loading state: mirrors the header + KPI + content rhythm of real pages. */
export function PageSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-label="Loading">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-7 w-48" />
      <Skeleton className="mt-3 h-4 w-full max-w-md" />
      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <Skeleton className="h-72 xl:col-span-2" />
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}
