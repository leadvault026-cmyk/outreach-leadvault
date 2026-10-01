import type { ReactNode } from "react";

export function DefinitionList({ items }: { items: Array<{ term: string; value: ReactNode }> }) {
  return (
    <dl className="bg-card divide-y rounded-lg border">
      {items.map((item) => (
        <div key={item.term} className="grid gap-1 px-4 py-3 sm:grid-cols-[220px_minmax(0,1fr)] sm:gap-4">
          <dt className="text-muted-foreground text-[13px] font-medium">{item.term}</dt>
          <dd className="min-w-0 text-sm break-words">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function NotSet({ children = "Not set" }: { children?: ReactNode }) {
  return <span className="text-muted-foreground italic">{children}</span>;
}
