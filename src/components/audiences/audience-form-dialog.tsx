"use client";

import { Pencil, Plus } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import {
  createAudienceAction,
  updateAudienceAction,
} from "@/app/w/[workspaceSlug]/audiences/actions";
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
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/server/action-result";

const inputClass =
  "h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type FormAction = (s: ActionResult<unknown> | null, f: FormData) => Promise<ActionResult<unknown>>;

/** Create (no audienceId) or edit the name and description of an audience. */
export function AudienceFormDialog({
  workspaceSlug,
  audienceId,
  initial,
}: {
  workspaceSlug: string;
  audienceId?: string;
  initial?: { name: string; description: string | null };
}) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const editing = Boolean(audienceId);
  return (
    <>
      <Button
        size="sm"
        variant={editing ? "outline" : "default"}
        onClick={() => {
          setFormKey((k) => k + 1);
          setOpen(true);
        }}
      >
        {editing ? <Pencil /> : <Plus />} {editing ? "Edit" : "New audience"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit audience" : "New audience"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Change the name or description. Members are not affected."
                : "Create an empty audience, then add prospects from the Prospects page."}
            </DialogDescription>
          </DialogHeader>
          <AudienceForm
            key={formKey}
            action={
              (audienceId
                ? updateAudienceAction.bind(null, workspaceSlug, audienceId)
                : createAudienceAction.bind(null, workspaceSlug)) as FormAction
            }
            editing={editing}
            initial={initial}
            onDone={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function AudienceForm({
  action: serverAction,
  editing,
  initial,
  onDone,
}: {
  action: FormAction;
  editing: boolean;
  initial?: { name: string; description: string | null };
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<ActionResult<unknown> | null, FormData>(
    serverAction,
    null,
  );
  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);

  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="aud-name" className="mb-1 block text-sm font-medium">
          Name
        </label>
        <input
          id="aud-name"
          name="name"
          required
          minLength={2}
          maxLength={120}
          defaultValue={initial?.name}
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor="aud-desc" className="mb-1 block text-sm font-medium">
          Description (optional)
        </label>
        <Textarea
          id="aud-desc"
          name="description"
          maxLength={500}
          rows={3}
          defaultValue={initial?.description ?? ""}
        />
      </div>
      {state && !state.ok ? <InlineAlert tone="danger">{state.error}</InlineAlert> : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : editing ? "Save changes" : "Create audience"}
        </Button>
      </DialogFooter>
    </form>
  );
}
