import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { reasonLabel } from "@/domain/eligibility";
import type { EligibilityStatus, ImportRowOutcome } from "@/domain/enums";
import { rowCategory } from "@/services/import-service";
import { ACTION_LABELS, CATEGORY_LABELS, RESULT_ACTION_LABELS } from "./import-labels";

type Row = {
  rowNumber: number;
  outcome: ImportRowOutcome;
  plannedOutcome: ImportRowOutcome | null;
  eligibility: EligibilityStatus | null;
  eligibilityReasons: string[];
  issues: Array<{ code: string; severity: "error" | "warning" | "info"; message: string }>;
  mapped: Record<string, unknown> | null;
  raw: Record<string, string>;
  prospectId: string | null;
};

function text(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

/**
 * Row-by-row view for the preview and results steps: what will happen / happened to each source
 * row, and every reason. Values are rendered as text (React escapes them) — never as HTML.
 */
export function ImportRowsTable({
  rows,
  phase,
  workspaceSlug,
}: {
  rows: Row[];
  phase: "preview" | "result";
  workspaceSlug: string;
}) {
  return (
    <ul className="divide-y rounded-lg border bg-card">
      {rows.map((r) => {
        const outcome = (phase === "preview" ? r.plannedOutcome : r.outcome) ?? "pending";
        const category = rowCategory(outcome, r.eligibility);
        const cat = CATEGORY_LABELS[category]!;
        const m = r.mapped ?? {};
        const company = text(m.companyName) ?? text(Object.values(r.raw)[0]) ?? "—";
        const issues = r.issues.filter(
          (i) => i.severity !== "info" || phase === "preview" || i.code === "UPDATED_FIELDS",
        );
        return (
          <li
            key={r.rowNumber}
            className="grid gap-2 px-4 py-3 md:grid-cols-[72px_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.4fr)] md:gap-4"
          >
            <div className="tabular text-xs text-muted-foreground">Row {r.rowNumber}</div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {phase === "result" && r.prospectId ? (
                  <Link
                    href={`/w/${workspaceSlug}/prospects/${r.prospectId}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {company}
                  </Link>
                ) : (
                  company
                )}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {[text(m.contactName), text(m.email)].filter(Boolean).join(" · ") ||
                  "No contact details"}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {[text(m.city), text(m.state), text(m.countryCode) ?? "Country unknown"]
                  .filter(Boolean)
                  .join(", ")}
              </p>
            </div>
            <div className="flex flex-wrap items-start gap-1.5">
              <StatusBadge status={category} label={cat.label} tone={cat.tone} />
              <span className="w-full text-xs text-muted-foreground">
                {(phase === "preview" ? ACTION_LABELS : RESULT_ACTION_LABELS)[outcome] ?? outcome}
              </span>
            </div>
            <div className="min-w-0 text-xs">
              {issues.length === 0 && r.eligibilityReasons.length === 0 ? (
                <span className="text-muted-foreground">No issues</span>
              ) : (
                <ul className="space-y-1">
                  {issues.map((i, idx) => (
                    <li
                      key={`${i.code}-${idx}`}
                      className={
                        i.severity === "error"
                          ? "text-danger"
                          : i.severity === "warning"
                            ? "text-warning"
                            : "text-muted-foreground"
                      }
                    >
                      {i.message}
                    </li>
                  ))}
                  {r.eligibilityReasons.length ? (
                    <li className="text-muted-foreground">
                      Eligibility: {r.eligibilityReasons.map(reasonLabel).join(", ")}
                    </li>
                  ) : null}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
