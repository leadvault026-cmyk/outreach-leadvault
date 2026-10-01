import type { LucideIcon } from "lucide-react";
import Link from "next/link";

export function KpiTile({
  label,
  value,
  hint,
  icon: Icon,
  href,
}: {
  label: string;
  value: number;
  hint?: string;
  icon: LucideIcon;
  /** When set, the whole tile links to the matching filtered list. */
  href?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
        <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </div>
      <p className="tabular mt-2 text-2xl font-semibold tracking-tight">{value.toLocaleString()}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </>
  );
  return href ? (
    <Link
      href={href}
      className="block rounded-lg border bg-card p-4 transition-colors hover:border-ring/60 hover:bg-muted/30"
    >
      {body}
    </Link>
  ) : (
    <div className="rounded-lg border bg-card p-4">{body}</div>
  );
}

export function Panel({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`min-w-0 rounded-lg border bg-card ${className ?? ""}`}>
      <header className="flex items-start justify-between gap-3 border-b px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action}
      </header>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}
