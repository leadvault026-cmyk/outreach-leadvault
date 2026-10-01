"use client";

import { useActionState } from "react";
import { updatePostalAddressAction } from "@/app/w/[workspaceSlug]/settings/workspace/actions";
import { InlineAlert } from "@/components/states/inline-alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/server/action-result";

export function PostalAddressForm({
  workspaceSlug,
  current,
}: {
  workspaceSlug: string;
  current: string | null;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    updatePostalAddressAction.bind(null, workspaceSlug),
    null,
  );
  const error = state && !state.ok ? state.error : null;
  return (
    <form action={action} className="space-y-3 rounded-lg border bg-card p-4">
      <div>
        <label htmlFor="postal" className="mb-1 block text-sm font-medium">
          Compliance postal address
        </label>
        <Textarea
          id="postal"
          name="postalAddress"
          rows={2}
          maxLength={300}
          defaultValue={current ?? ""}
          aria-invalid={error ? true : undefined}
          aria-describedby="postal-hint"
        />
        <p id="postal-hint" className="mt-1 text-xs text-muted-foreground">
          The sender&apos;s physical address, printed in every email footer. Required to launch a
          campaign.
        </p>
      </div>
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      {state?.ok ? <InlineAlert tone="success">Postal address saved.</InlineAlert> : null}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Save address"}
      </Button>
    </form>
  );
}
