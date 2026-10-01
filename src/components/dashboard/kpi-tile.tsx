import type { LucideIcon } from "lucide-react";

export function KpiTile({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: number;
  hint?: string;
  icon: LucideIcon;
}) {
  return (
    <div className="bg-card rounded-lg border p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-muted-foreground text-[13px] font-medium">{label}</p>
        <Icon aria-hidden className="text-muted-foreground size-4 shrink-0" />
      </div>
      <p className="tabular mt-2 text-2xl font-semibold tracking-tight">{value.toLocaleString()}</p>
      {hint ? <p className="text-muted-foreground mt-1 text-xs">{hint}</p> : null}
    </div>
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
    <section className={`bg-card min-w-0 rounded-lg border ${className ?? ""}`}>
      <header className="flex items-start justify-between gap-3 border-b px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description ? <p className="text-muted-foreground mt-0.5 text-xs">{description}</p> : null}
        </div>
        {action}
      </header>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}
