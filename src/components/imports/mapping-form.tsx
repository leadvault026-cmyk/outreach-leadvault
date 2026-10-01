"use client";

import { AlertTriangle } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { saveMappingAction } from "@/app/w/[workspaceSlug]/imports/actions";
import { InlineAlert } from "@/components/states/inline-alert";
import { Button } from "@/components/ui/button";
import { TARGET_FIELDS, targetLabel } from "@/domain/imports/fields";
import { cn } from "@/lib/utils";

const NEW_CUSTOM = "__new_custom__";

export function MappingForm({
  workspaceSlug,
  importId,
  headers,
  samples,
  initial,
  ambiguous,
  customFields,
  canCreateCustom,
}: {
  workspaceSlug: string;
  importId: string;
  headers: string[];
  samples: Record<string, string[]>;
  initial: Record<string, string>;
  ambiguous: string[];
  customFields: Array<{ key: string; label: string }>;
  canCreateCustom: boolean;
}) {
  const [mapping, setMapping] = useState<Record<string, string>>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Exclusive destinations: a field already used by another column is shown as taken.
  const usedBy = useMemo(() => {
    const m = new Map<string, string>();
    for (const [h, t] of Object.entries(mapping))
      if (t !== "ignore" && t !== NEW_CUSTOM) m.set(t, h);
    return m;
  }, [mapping]);
  const companyMapped = Object.values(mapping).includes("company_name");
  const mappedCount = Object.values(mapping).filter((t) => t !== "ignore").length;

  const groups = [...new Set(TARGET_FIELDS.map((f) => f.group))];

  const submit = () => {
    setError(null);
    const createCustom = headers.filter((h) => mapping[h] === NEW_CUSTOM);
    const clean = Object.fromEntries(
      headers.map((h) => [h, mapping[h] === NEW_CUSTOM ? "ignore" : (mapping[h] ?? "ignore")]),
    );
    start(async () => {
      const res = await saveMappingAction(workspaceSlug, {
        importId,
        mapping: clean,
        createCustom,
      });
      if (res && !res.ok) setError(res.error);
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {mappedCount} of {headers.length} columns mapped. Columns left as “Ignore” are kept in the
          import record but not stored on prospects.
        </p>
      </div>

      {ambiguous.length ? (
        <InlineAlert tone="warning" title="Some columns need your decision">
          {ambiguous.map((h) => `“${h}”`).join(", ")} could each be the same field, so none was
          chosen automatically.
        </InlineAlert>
      ) : null}

      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)] gap-4 border-b bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground md:grid">
          <span>Source column</span>
          <span>Sample values</span>
          <span>LeadVault field</span>
        </div>
        <ul className="divide-y">
          {headers.map((h) => {
            const value = mapping[h] ?? "ignore";
            const selectId = `map-${headers.indexOf(h)}`;
            const conflict = value !== "ignore" && value !== NEW_CUSTOM && usedBy.get(value) !== h;
            return (
              <li
                key={h}
                className="grid gap-2 px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)] md:items-center md:gap-4"
              >
                <label htmlFor={selectId} className="min-w-0 text-sm font-medium break-words">
                  {h}
                  {ambiguous.includes(h) ? (
                    <AlertTriangle
                      aria-label="Needs a decision"
                      className="ml-1.5 inline size-3.5 text-warning"
                    />
                  ) : null}
                </label>
                <p
                  className="min-w-0 truncate text-xs text-muted-foreground"
                  title={(samples[h] ?? []).join(" · ")}
                >
                  {(samples[h] ?? []).filter(Boolean).join(" · ") || "No values in the first rows"}
                </p>
                <select
                  id={selectId}
                  value={value}
                  onChange={(e) => setMapping((m) => ({ ...m, [h]: e.target.value }))}
                  className={cn(
                    "h-9 w-full rounded-md border bg-background px-2 text-sm",
                    value === "ignore" && "text-muted-foreground",
                    conflict && "border-danger",
                  )}
                  aria-invalid={conflict || undefined}
                >
                  <option value="ignore">Ignore this column</option>
                  {groups.map((g) => (
                    <optgroup key={g} label={g}>
                      {TARGET_FIELDS.filter((f) => f.group === g).map((f) => {
                        const takenBy = usedBy.get(f.key);
                        const taken = takenBy !== undefined && takenBy !== h;
                        return (
                          <option key={f.key} value={f.key} disabled={taken}>
                            {f.label}
                            {"required" in f && f.required ? " (required)" : ""}
                            {taken ? ` — used by “${takenBy}”` : ""}
                          </option>
                        );
                      })}
                    </optgroup>
                  ))}
                  {customFields.length || canCreateCustom ? (
                    <optgroup label="Custom fields">
                      {customFields.map((c) => {
                        const key = `custom:${c.key}`;
                        const takenBy = usedBy.get(key);
                        return (
                          <option
                            key={key}
                            value={key}
                            disabled={takenBy !== undefined && takenBy !== h}
                          >
                            {c.label}
                          </option>
                        );
                      })}
                      {canCreateCustom ? (
                        <option value={NEW_CUSTOM}>Keep as a new custom field</option>
                      ) : null}
                    </optgroup>
                  ) : null}
                </select>
                {conflict ? (
                  <p className="text-xs text-danger md:col-start-3">
                    {targetLabel(value)} is already mapped from another column.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>

      {!companyMapped ? (
        <InlineAlert tone="warning">Map one column to Company name — it is required.</InlineAlert>
      ) : null}
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={submit} disabled={pending || !companyMapped}>
          {pending ? "Saving…" : "Save mapping and continue"}
        </Button>
        {!canCreateCustom ? (
          <p className="text-xs text-muted-foreground">Only Admins can create new custom fields.</p>
        ) : null}
      </div>
    </div>
  );
}
