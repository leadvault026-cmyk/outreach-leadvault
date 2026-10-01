import { CheckCircle2, ShieldCheck, type LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import type { ModuleInfo } from "@/config/modules";
import { EmptyState } from "./empty-state";

/**
 * Intentional page for a module that activates in a later phase: explains what it does, what the
 * operator will be able to do, and the safeguards that apply.
 */
export function ModulePlaceholder({ info, icon }: { info: ModuleInfo; icon: LucideIcon }) {
  return (
    <>
      <PageHeader
        title={info.title}
        description={info.summary}
        actions={
          <Button disabled aria-describedby="module-status">
            {info.primaryAction}
          </Button>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-labelledby="module-empty">
          <h2 id="module-empty" className="sr-only">
            {info.title} records
          </h2>
          <EmptyState
            icon={icon}
            title={`${info.title} isn't active in this build yet`}
            description={info.emptyDescription}
            headingLevel={3}
            className="bg-card min-h-[320px]"
          />
        </section>

        <aside className="space-y-4">
          <div className="bg-card rounded-lg border p-5">
            <p id="module-status" className="flex items-center gap-2 text-sm font-semibold">
              <span className="bg-info size-2 rounded-full" aria-hidden />
              Module activates in {info.phase}
            </p>
            <p className="text-muted-foreground mt-1.5 text-[13px] leading-relaxed">
              The foundation (data model, permissions and workspace isolation) is in place. Actions
              become available when this module is activated.
            </p>
            <h3 className="mt-4 text-[13px] font-semibold">What you&apos;ll be able to do</h3>
            <ul className="mt-2 space-y-2">
              {info.capabilities.map((c) => (
                <li key={c} className="text-muted-foreground flex gap-2 text-[13px] leading-snug">
                  <CheckCircle2 aria-hidden className="text-success mt-0.5 size-3.5 shrink-0" />
                  {c}
                </li>
              ))}
            </ul>
          </div>

          {info.safeguards?.length ? (
            <div className="bg-card rounded-lg border p-5">
              <h3 className="flex items-center gap-2 text-[13px] font-semibold">
                <ShieldCheck aria-hidden className="size-4" /> Safeguards
              </h3>
              <ul className="mt-2 space-y-1.5">
                {info.safeguards.map((s) => (
                  <li key={s} className="text-muted-foreground text-[13px] leading-snug">
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
      </div>
    </>
  );
}
