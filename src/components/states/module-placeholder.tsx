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
            className="min-h-[320px] bg-card"
          />
        </section>

        <aside className="space-y-4">
          <div className="rounded-lg border bg-card p-5">
            <p id="module-status" className="flex items-center gap-2 text-sm font-semibold">
              <span className="size-2 rounded-full bg-info" aria-hidden />
              Module activates in {info.phase}
            </p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
              The foundation (data model, permissions and workspace isolation) is in place. Actions
              become available when this module is activated.
            </p>
            <h3 className="mt-4 text-[13px] font-semibold">What you&apos;ll be able to do</h3>
            <ul className="mt-2 space-y-2">
              {info.capabilities.map((c) => (
                <li key={c} className="flex gap-2 text-[13px] leading-snug text-muted-foreground">
                  <CheckCircle2 aria-hidden className="mt-0.5 size-3.5 shrink-0 text-success" />
                  {c}
                </li>
              ))}
            </ul>
          </div>

          {info.safeguards?.length ? (
            <div className="rounded-lg border bg-card p-5">
              <h3 className="flex items-center gap-2 text-[13px] font-semibold">
                <ShieldCheck aria-hidden className="size-4" /> Safeguards
              </h3>
              <ul className="mt-2 space-y-1.5">
                {info.safeguards.map((s) => (
                  <li key={s} className="text-[13px] leading-snug text-muted-foreground">
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
