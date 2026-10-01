import { Check } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export type WizardStep = "upload" | "mapping" | "settings" | "preview" | "results";

const STEPS: Array<{ key: WizardStep; label: string }> = [
  { key: "upload", label: "Upload" },
  { key: "mapping", label: "Map columns" },
  { key: "settings", label: "Settings" },
  { key: "preview", label: "Validate & preview" },
  { key: "results", label: "Results" },
];

/** Accessible wizard progress. Completed steps that can be revisited are links. */
export function ImportSteps({
  current,
  reachable,
  hrefFor,
}: {
  current: WizardStep;
  reachable: WizardStep[];
  hrefFor: (step: WizardStep) => string | null;
}) {
  const currentIndex = STEPS.findIndex((s) => s.key === current);
  return (
    <nav aria-label="Import progress" className="mb-6">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-2 text-[13px]">
        {STEPS.map((s, i) => {
          const done = i < currentIndex;
          const active = s.key === current;
          const href = !active && reachable.includes(s.key) ? hrefFor(s.key) : null;
          const content = (
            <>
              <span
                aria-hidden
                className={cn(
                  "flex size-5 items-center justify-center rounded-full border text-[11px] font-semibold",
                  active && "border-primary bg-primary text-primary-foreground",
                  done && !active && "border-success bg-success-soft text-success",
                  !active && !done && "text-muted-foreground",
                )}
              >
                {done ? <Check className="size-3" /> : i + 1}
              </span>
              <span className={cn(active ? "font-semibold" : "text-muted-foreground")}>
                {s.label}
              </span>
            </>
          );
          return (
            <li key={s.key} className="flex items-center gap-1">
              {href ? (
                <Link
                  href={href}
                  className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted"
                >
                  {content}
                </Link>
              ) : (
                <span
                  aria-current={active ? "step" : undefined}
                  className="flex items-center gap-2 px-2 py-1"
                >
                  {content}
                </span>
              )}
              {i < STEPS.length - 1 ? (
                <span aria-hidden className="text-muted-foreground">
                  /
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
