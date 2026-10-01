"use client";

import { ListPlus } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import {
  addToAudienceAction,
  previewSelectionAction,
  type SelectionSummary,
} from "@/app/w/[workspaceSlug]/prospects/actions";
import { InlineAlert } from "@/components/states/inline-alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ELIGIBILITY_LABELS } from "@/domain/eligibility";
import type { AddMembersResult, IncludePolicy } from "@/services/audience-service";
import { selectClass } from "./filter-bar";
import type { TableSelection } from "./prospect-table";

const INCLUDE_OPTIONS: Array<{ value: IncludePolicy; label: string; hint: string }> = [
  {
    value: "eligible",
    label: "Eligible only (recommended)",
    hint: "Adds prospects that currently pass every eligibility rule.",
  },
  {
    value: "eligible_and_review",
    label: "Eligible and review required",
    hint: "Also adds prospects that need a human check. They still cannot be contacted until resolved.",
  },
  {
    value: "all",
    label: "Everyone selected",
    hint: "Adds ineligible and suppressed prospects too, for record keeping. Membership never overrides suppression or eligibility.",
  },
];

type Result = AddMembersResult & { audienceId: string };

export function AddToAudienceDialog({
  workspaceSlug,
  selection,
  filterQuery,
  audiences,
  onDone,
}: {
  workspaceSlug: string;
  selection: TableSelection;
  /** Current filter query string, used when "all matching" is selected. */
  filterQuery: string;
  audiences: Array<{ id: string; name: string }>;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<SelectionSummary | null>(null);
  const [kind, setKind] = useState<"new" | "existing">(audiences.length ? "existing" : "new");
  const [include, setInclude] = useState<IncludePolicy>("eligible");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  const [loading, startLoading] = useTransition();

  const payload =
    selection.mode === "ids"
      ? { mode: "ids" as const, ids: selection.ids }
      : { mode: "filter" as const, query: filterQuery };

  const openDialog = () => {
    setSummary(null);
    setError(null);
    setResult(null);
    setOpen(true);
    startLoading(async () => {
      const res = await previewSelectionAction(workspaceSlug, payload);
      if (res.ok) setSummary(res.data);
      else setError(res.error);
    });
  };

  const submit = (formData: FormData) =>
    start(async () => {
      setError(null);
      const target =
        kind === "new"
          ? {
              kind: "new" as const,
              name: String(formData.get("name") ?? ""),
              description: String(formData.get("description") ?? ""),
            }
          : { kind: "existing" as const, audienceId: String(formData.get("audienceId") ?? "") };
      const res = await addToAudienceAction(workspaceSlug, { selection: payload, include, target });
      if (res.ok) setResult(res.data);
      else setError(res.error);
    });

  const close = (o: boolean) => {
    if (pending) return;
    setOpen(o);
    if (!o) {
      if (result) onDone();
      setResult(null);
      setError(null);
    }
  };

  const willAdd = summary
    ? summary.breakdown.ELIGIBLE +
      (include !== "eligible" ? summary.breakdown.NEEDS_REVIEW : 0) +
      (include === "all"
        ? summary.breakdown.INELIGIBLE + summary.breakdown.SUPPRESSED + summary.breakdown.UNKNOWN
        : 0)
    : null;

  return (
    <>
      <Button size="sm" onClick={openDialog}>
        <ListPlus /> Add to audience
      </Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{result ? "Added to audience" : "Add to audience"}</DialogTitle>
            <DialogDescription>
              {result
                ? "Here is exactly what happened to every selected prospect."
                : "Audiences are saved lists for later campaigns. Nothing is sent."}
            </DialogDescription>
          </DialogHeader>

          {result ? (
            <div className="space-y-3 text-sm">
              <dl className="tabular grid grid-cols-[1fr_auto] gap-x-6 gap-y-1.5">
                <dt>Selected</dt>
                <dd className="text-right">{result.selected.toLocaleString()}</dd>
                <dt>Added</dt>
                <dd className="text-right font-medium">{result.added.toLocaleString()}</dd>
                <dt>Already in the audience</dt>
                <dd className="text-right">{result.alreadyMembers.toLocaleString()}</dd>
                {(["NEEDS_REVIEW", "INELIGIBLE", "SUPPRESSED"] as const).map((k) =>
                  result.excluded[k] ? (
                    <FragmentRow
                      key={k}
                      label={`Not added — ${ELIGIBILITY_LABELS[k].toLowerCase()}`}
                      value={result.excluded[k]}
                    />
                  ) : null,
                )}
                {result.excluded.UNKNOWN ? (
                  <FragmentRow
                    label="Not added — not yet evaluated"
                    value={result.excluded.UNKNOWN}
                  />
                ) : null}
                {result.notFound ? (
                  <FragmentRow label="Not added — no longer available" value={result.notFound} />
                ) : null}
              </dl>
              <DialogFooter>
                <Button variant="outline" onClick={() => close(false)}>
                  Close
                </Button>
                <Button asChild>
                  <Link href={`/w/${workspaceSlug}/audiences/${result.audienceId}`}>
                    Open audience
                  </Link>
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form action={submit} className="space-y-5">
              <section
                aria-label="Selection summary"
                className="rounded-md border bg-muted/30 p-3 text-sm"
              >
                {loading || !summary ? (
                  <p className="text-muted-foreground">Checking the selection…</p>
                ) : (
                  <>
                    <p className="tabular font-medium">
                      {summary.count.toLocaleString()} prospect{summary.count === 1 ? "" : "s"}{" "}
                      selected
                    </p>
                    <p className="tabular mt-1 text-xs text-muted-foreground">
                      {ELIGIBILITY_LABELS.ELIGIBLE}: {summary.breakdown.ELIGIBLE.toLocaleString()} ·{" "}
                      {ELIGIBILITY_LABELS.NEEDS_REVIEW}:{" "}
                      {summary.breakdown.NEEDS_REVIEW.toLocaleString()} ·{" "}
                      {ELIGIBILITY_LABELS.INELIGIBLE}:{" "}
                      {summary.breakdown.INELIGIBLE.toLocaleString()} ·{" "}
                      {ELIGIBILITY_LABELS.SUPPRESSED}:{" "}
                      {summary.breakdown.SUPPRESSED.toLocaleString()}
                    </p>
                    {summary.truncated ? (
                      <p className="mt-1 text-xs text-warning">
                        Only the first {summary.count.toLocaleString()} matching prospects can be
                        added at once.
                      </p>
                    ) : null}
                  </>
                )}
              </section>

              <fieldset className="space-y-2">
                <legend className="mb-1 text-sm font-medium">Audience</legend>
                {audiences.length ? (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="kind"
                      checked={kind === "existing"}
                      onChange={() => setKind("existing")}
                      className="size-4 accent-primary"
                    />
                    Add to an existing audience
                  </label>
                ) : null}
                {kind === "existing" && audiences.length ? (
                  <div className="pl-6">
                    <label htmlFor="ata-audience" className="sr-only">
                      Existing audience
                    </label>
                    <select id="ata-audience" name="audienceId" className={selectClass} required>
                      {audiences.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="kind"
                    checked={kind === "new"}
                    onChange={() => setKind("new")}
                    className="size-4 accent-primary"
                  />
                  Create a new audience
                </label>
                {kind === "new" ? (
                  <div className="space-y-2 pl-6">
                    <div>
                      <label
                        htmlFor="ata-name"
                        className="mb-1 block text-xs text-muted-foreground"
                      >
                        Name
                      </label>
                      <input
                        id="ata-name"
                        name="name"
                        required
                        minLength={2}
                        maxLength={120}
                        className={selectClass}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="ata-desc"
                        className="mb-1 block text-xs text-muted-foreground"
                      >
                        Description (optional)
                      </label>
                      <input
                        id="ata-desc"
                        name="description"
                        maxLength={500}
                        className={selectClass}
                      />
                    </div>
                  </div>
                ) : null}
              </fieldset>

              <fieldset className="space-y-2">
                <legend className="mb-1 text-sm font-medium">Which prospects to add</legend>
                {INCLUDE_OPTIONS.map((o) => (
                  <label key={o.value} className="flex gap-2 text-sm">
                    <input
                      type="radio"
                      name="include"
                      value={o.value}
                      checked={include === o.value}
                      onChange={() => setInclude(o.value)}
                      className="mt-0.5 size-4 shrink-0 accent-primary"
                    />
                    <span>
                      {o.label}
                      <span className="block text-xs text-muted-foreground">{o.hint}</span>
                    </span>
                  </label>
                ))}
              </fieldset>

              {willAdd !== null && summary ? (
                <p className="tabular text-sm" aria-live="polite">
                  Up to <strong>{willAdd.toLocaleString()}</strong> will be added;{" "}
                  {(summary.count - willAdd).toLocaleString()} will be left out and reported.
                </p>
              ) : null}
              {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => close(false)}
                  disabled={pending}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={pending || loading || !summary}>
                  {pending ? "Adding…" : "Add prospects"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function FragmentRow({ label, value }: { label: string; value: number }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{value.toLocaleString()}</dd>
    </>
  );
}
