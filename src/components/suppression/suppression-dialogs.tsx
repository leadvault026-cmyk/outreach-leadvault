"use client";

import { Ban, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import {
  addSuppressionAction,
  liftSuppressionAction,
} from "@/app/w/[workspaceSlug]/suppression/actions";
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
import { MANUAL_SUPPRESSION_REASONS, SUPPRESSION_REASON_LABELS } from "@/domain/suppression";
import type { ActionResult } from "@/server/action-result";

const inputClass =
  "h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-danger";

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} className="mt-1 text-xs text-danger">
      {message}
    </p>
  ) : null;
}

export function AddSuppressionDialog({
  workspaceSlug,
  canGlobal,
  defaultValue,
  defaultType = "email",
  triggerLabel = "Add suppression",
  triggerVariant = "default",
}: {
  workspaceSlug: string;
  canGlobal: boolean;
  defaultValue?: string;
  defaultType?: "email" | "domain";
  triggerLabel?: string;
  triggerVariant?: "default" | "outline";
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  // A fresh form (and fresh action state) every time the dialog opens.
  const [formKey, setFormKey] = useState(0);

  return (
    <>
      <Button
        size="sm"
        variant={triggerVariant}
        onClick={() => {
          setFormKey((k) => k + 1);
          setOpen(true);
        }}
      >
        <Ban /> {triggerLabel}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add a suppression</DialogTitle>
            <DialogDescription>
              Suppressed addresses and domains are never contacted. Nothing is deleted, and the
              entry can only be lifted with a recorded reason.
            </DialogDescription>
          </DialogHeader>
          <AddSuppressionForm
            key={formKey}
            workspaceSlug={workspaceSlug}
            canGlobal={canGlobal}
            defaultValue={defaultValue}
            defaultType={defaultType}
            onPending={setPending}
            onClose={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function AddSuppressionForm({
  workspaceSlug,
  canGlobal,
  defaultValue,
  defaultType,
  onPending,
  onClose,
}: {
  workspaceSlug: string;
  canGlobal: boolean;
  defaultValue?: string;
  defaultType: "email" | "domain";
  onPending: (p: boolean) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState<
    ActionResult<{ reevaluated: number }> | null,
    FormData
  >(addSuppressionAction.bind(null, workspaceSlug), null);
  const fe = state && !state.ok ? state.fieldErrors : undefined;

  useEffect(() => onPending(pending), [pending, onPending]);
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  if (state?.ok) {
    return (
      <div className="space-y-4">
        <InlineAlert tone="success">
          {state.message} {state.data.reevaluated.toLocaleString()} prospect
          {state.data.reevaluated === 1 ? " was" : "s were"} re-evaluated.
        </InlineAlert>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Suppress</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {(["email", "domain"] as const).map((t) => (
            <label key={t} className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="valueType"
                value={t}
                defaultChecked={t === defaultType}
                className="size-4 accent-primary"
              />
              {t === "email" ? "An email address" : "A whole domain"}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor="sup-value" className="mb-1 block text-sm font-medium">
          Email address or domain
        </label>
        <input
          id="sup-value"
          name="value"
          required
          maxLength={320}
          defaultValue={defaultValue}
          placeholder="name@company.example or company.example"
          aria-invalid={fe?.value ? true : undefined}
          aria-describedby={fe?.value ? "sup-value-error" : undefined}
          className={inputClass}
        />
        <FieldError id="sup-value-error" message={fe?.value} />
      </div>
      <div>
        <label htmlFor="sup-reason" className="mb-1 block text-sm font-medium">
          Reason
        </label>
        <select
          id="sup-reason"
          name="reason"
          className={inputClass}
          defaultValue="MANUAL_DO_NOT_CONTACT"
        >
          {MANUAL_SUPPRESSION_REASONS.map((r) => (
            <option key={r} value={r}>
              {SUPPRESSION_REASON_LABELS[r]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="sup-note" className="mb-1 block text-sm font-medium">
          Note (required)
        </label>
        <Textarea
          id="sup-note"
          name="note"
          required
          minLength={5}
          maxLength={500}
          rows={3}
          placeholder="For example: asked not to be contacted again on 3 March."
          aria-invalid={fe?.note ? true : undefined}
          aria-describedby={fe?.note ? "sup-note-error" : undefined}
        />
        <FieldError id="sup-note-error" message={fe?.note} />
      </div>
      {canGlobal ? (
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Scope</legend>
          <div className="space-y-1.5 text-sm">
            <label className="flex gap-2">
              <input
                type="radio"
                name="scope"
                value="workspace"
                defaultChecked
                className="mt-0.5 size-4 accent-primary"
              />
              This workspace only
            </label>
            <label className="flex gap-2">
              <input
                type="radio"
                name="scope"
                value="global"
                className="mt-0.5 size-4 accent-primary"
              />
              <span>
                LeadVault-wide (every workspace)
                <span className="block text-xs text-muted-foreground">
                  Platform administrators only. Use for legal or abuse requests.
                </span>
              </span>
            </label>
          </div>
        </fieldset>
      ) : (
        <input type="hidden" name="scope" value="workspace" />
      )}
      {state && !state.ok ? <InlineAlert tone="danger">{state.error}</InlineAlert> : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add suppression"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function LiftSuppressionDialog({
  workspaceSlug,
  suppressionId,
  value,
  global,
}: {
  workspaceSlug: string;
  suppressionId: string;
  value: string;
  global: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<
    ActionResult<{ reevaluated: number }> | null,
    FormData
  >(async (prev, formData) => {
    const res = await liftSuppressionAction(workspaceSlug, prev, formData);
    if (res.ok) {
      setOpen(false);
      router.refresh();
    }
    return res;
  }, null);
  const fe = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        aria-label={`Lift suppression for ${value}`}
      >
        <Undo2 /> Lift
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Lift suppression</DialogTitle>
            <DialogDescription>
              <span className="font-medium break-all text-foreground">{value}</span> will become
              contactable again if every other eligibility rule passes.
              {global
                ? " This is a LeadVault-wide suppression and affects every workspace."
                : ""}{" "}
              The record and your reason are kept permanently.
            </DialogDescription>
          </DialogHeader>
          <form action={action} className="space-y-4">
            <input type="hidden" name="suppressionId" value={suppressionId} />
            <div>
              <label htmlFor={`lift-${suppressionId}`} className="mb-1 block text-sm font-medium">
                Reason for lifting (required)
              </label>
              <Textarea
                id={`lift-${suppressionId}`}
                name="reason"
                required
                minLength={10}
                maxLength={500}
                rows={3}
                aria-invalid={fe?.reason ? true : undefined}
                aria-describedby={fe?.reason ? `lift-${suppressionId}-error` : undefined}
              />
              <FieldError id={`lift-${suppressionId}-error`} message={fe?.reason} />
            </div>
            {state && !state.ok ? <InlineAlert tone="danger">{state.error}</InlineAlert> : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending ? "Lifting…" : "Lift suppression"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
