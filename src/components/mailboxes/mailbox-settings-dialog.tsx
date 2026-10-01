"use client";

import { Settings2 } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { updateMailboxAction } from "@/app/w/[workspaceSlug]/mailboxes/actions";
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
import type { ActionResult } from "@/server/action-result";

const inputClass =
  "h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-danger";

export function MailboxSettingsDialog({
  workspaceSlug,
  mailbox,
}: {
  workspaceSlug: string;
  mailbox: {
    id: string;
    emailAddress: string;
    dailySendLimit: number;
    minSecondsBetweenSends: number;
    enabled: boolean;
  };
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        aria-label={`Settings for ${mailbox.emailAddress}`}
        onClick={() => {
          setKey((k) => k + 1);
          setOpen(true);
        }}
      >
        <Settings2 /> Settings
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mailbox settings</DialogTitle>
            <DialogDescription className="break-all">{mailbox.emailAddress}</DialogDescription>
          </DialogHeader>
          <Form
            key={key}
            workspaceSlug={workspaceSlug}
            mailbox={mailbox}
            onDone={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function Form({
  workspaceSlug,
  mailbox,
  onDone,
}: {
  workspaceSlug: string;
  mailbox: { id: string; dailySendLimit: number; minSecondsBetweenSends: number; enabled: boolean };
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    updateMailboxAction.bind(null, workspaceSlug, mailbox.id),
    null,
  );
  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="mb-limit" className="mb-1 block text-sm font-medium">
          Daily sending limit
        </label>
        <input
          id="mb-limit"
          name="dailySendLimit"
          type="number"
          min={1}
          max={2000}
          defaultValue={mailbox.dailySendLimit}
          aria-invalid={fe?.dailySendLimit ? true : undefined}
          className={inputClass}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          {fe?.dailySendLimit ??
            "Shared by every campaign using this mailbox. 30–50 per day is a safe range for a warmed-up mailbox."}
        </p>
      </div>
      <div>
        <label htmlFor="mb-gap" className="mb-1 block text-sm font-medium">
          Seconds between emails
        </label>
        <input
          id="mb-gap"
          name="minSecondsBetweenSends"
          type="number"
          min={0}
          max={3600}
          defaultValue={mailbox.minSecondsBetweenSends}
          aria-invalid={fe?.minSecondsBetweenSends ? true : undefined}
          className={inputClass}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          {fe?.minSecondsBetweenSends ??
            "A random extra delay of up to 40% is added to look natural."}
        </p>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={mailbox.enabled}
          className="mt-0.5 size-4 accent-primary"
        />
        <span>
          Enabled for sending
          <span className="block text-xs text-muted-foreground">
            Disabled mailboxes send nothing; their campaigns wait.
          </span>
        </span>
      </label>
      {state && !state.ok ? <InlineAlert tone="danger">{state.error}</InlineAlert> : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}
