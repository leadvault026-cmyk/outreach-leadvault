"use client";

import { useActionState } from "react";
import { validateImportAction } from "@/app/w/[workspaceSlug]/imports/actions";
import { Field } from "@/components/forms/field";
import { InlineAlert } from "@/components/states/inline-alert";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/server/action-result";

type Defaults = {
  sourceLabel: string;
  reference: string;
  defaultCountryCode: string;
  defaultBusinessType: string;
  verificationMode: "trust" | "ignore";
  verificationSourceLabel: string;
  onExisting: "update" | "skip";
};

export function SettingsForm({
  workspaceSlug,
  importId,
  defaults,
  countries,
  hasCountryColumn,
  hasVerificationColumns,
}: {
  workspaceSlug: string;
  importId: string;
  defaults: Defaults;
  countries: Array<{ code: string; name: string }>;
  hasCountryColumn: boolean;
  hasVerificationColumns: boolean;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    validateImportAction.bind(null, workspaceSlug, importId),
    null,
  );
  const fe = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={action} className="max-w-2xl space-y-6">
      <fieldset className="space-y-4 rounded-lg border bg-card p-5">
        <legend className="px-1 text-sm font-semibold">About this import</legend>
        <Field
          id="sourceLabel"
          name="sourceLabel"
          label="Import name"
          defaultValue={defaults.sourceLabel}
          required
          error={fe?.sourceLabel}
          hint="For example: “OTD Global — Texas medical providers, batch 3”."
        />
        <Field
          id="reference"
          name="reference"
          label="Source / reference (optional)"
          defaultValue={defaults.reference}
          error={fe?.reference}
          hint="Where the data came from, e.g. the research project or delivery reference."
        />
      </fieldset>

      <fieldset className="space-y-4 rounded-lg border bg-card p-5">
        <legend className="px-1 text-sm font-semibold">Defaults for missing values</legend>
        <div className="space-y-1.5">
          <label htmlFor="defaultCountryCode" className="text-sm font-medium">
            Default country
          </label>
          <select
            id="defaultCountryCode"
            name="defaultCountryCode"
            defaultValue={defaults.defaultCountryCode}
            className="h-10 w-full rounded-md border bg-background px-2 text-sm"
          >
            <option value="">No default — leave the country unknown</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name} ({c.code})
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            {hasCountryColumn
              ? "Applied only to rows whose country cell is empty. Rows with a country keep their own."
              : "This file has no country column. Only choose a default if every row is genuinely in that country — otherwise leave it unknown and those prospects will need review."}{" "}
            No country is ever assumed.
          </p>
        </div>
        <Field
          id="defaultBusinessType"
          name="defaultBusinessType"
          label="Default provider type / industry (optional)"
          defaultValue={defaults.defaultBusinessType}
          error={fe?.defaultBusinessType}
          hint="Used only for rows without one."
        />
      </fieldset>

      <fieldset className="space-y-3 rounded-lg border bg-card p-5">
        <legend className="px-1 text-sm font-semibold">Email verification</legend>
        {!hasVerificationColumns ? (
          <p className="text-xs text-muted-foreground">
            No verification columns are mapped, so all emails will be treated as unverified.
          </p>
        ) : null}
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="verificationMode"
            value="trust"
            defaultChecked={defaults.verificationMode === "trust"}
            className="mt-1"
          />
          <span>
            <span className="font-medium">Use verification results from LeadVault research</span>
            <span className="block text-xs text-muted-foreground">
              Only recognized results with a YYYY-MM-DD date are trusted. Unrecognized labels are
              treated as unverified.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="verificationMode"
            value="ignore"
            defaultChecked={defaults.verificationMode === "ignore"}
            className="mt-1"
          />
          <span>
            <span className="font-medium">Ignore verification columns</span>
            <span className="block text-xs text-muted-foreground">
              All emails are treated as unverified.
            </span>
          </span>
        </label>
        <Field
          id="verificationSourceLabel"
          name="verificationSourceLabel"
          label="Verification source label"
          defaultValue={defaults.verificationSourceLabel}
          error={fe?.verificationSourceLabel}
          hint="Recorded on each verified prospect when the file has no source column."
        />
      </fieldset>

      <fieldset className="space-y-3 rounded-lg border bg-card p-5">
        <legend className="px-1 text-sm font-semibold">Prospects that already exist</legend>
        <p className="text-xs text-muted-foreground">
          A row matches an existing prospect in this workspace by email, then LeadVault record ID,
          then (for rows without email) company + contact + website domain. Other workspaces are
          never affected.
        </p>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="onExisting"
            value="update"
            defaultChecked={defaults.onExisting === "update"}
            className="mt-1"
          />
          <span>
            <span className="font-medium">Update them with the new values</span>
            <span className="block text-xs text-muted-foreground">
              Empty cells never erase existing data.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="onExisting"
            value="skip"
            defaultChecked={defaults.onExisting === "skip"}
            className="mt-1"
          />
          <span>
            <span className="font-medium">Skip them</span>
            <span className="block text-xs text-muted-foreground">
              Existing prospects are left exactly as they are.
            </span>
          </span>
        </label>
      </fieldset>

      {state && !state.ok ? <InlineAlert tone="danger">{state.error}</InlineAlert> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Validating every row…" : "Validate and preview"}
      </Button>
    </form>
  );
}
