"use client";

import { useState, useTransition } from "react";
import { cancelImportAction, commitImportAction } from "@/app/w/[workspaceSlug]/imports/actions";
import { InlineAlert } from "@/components/states/inline-alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Confirm-and-run controls for the preview step. */
export function ImportActionsBar({
  workspaceSlug,
  importId,
  willStore,
  notImported,
}: {
  workspaceSlug: string;
  importId: string;
  willStore: number;
  notImported: number;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [cancelling, startCancel] = useTransition();

  const run = () =>
    start(async () => {
      setError(null);
      const res = await commitImportAction(workspaceSlug, importId);
      if (res && !res.ok) {
        setError(res.error);
        setOpen(false);
      }
    });

  return (
    <div className="space-y-3">
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => setOpen(true)} disabled={pending || willStore === 0}>
          Import {willStore.toLocaleString()} prospect{willStore === 1 ? "" : "s"}
        </Button>
        <Button
          variant="outline"
          disabled={cancelling || pending}
          onClick={() =>
            startCancel(async () => {
              const res = await cancelImportAction(workspaceSlug, importId);
              if (res && !res.ok) setError(res.error);
            })
          }
        >
          {cancelling ? "Cancelling…" : "Cancel import"}
        </Button>
      </div>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run this import?</DialogTitle>
            <DialogDescription>
              {willStore.toLocaleString()} rows will be stored as new or updated prospects.{" "}
              {notImported > 0
                ? `${notImported.toLocaleString()} rows will not be imported (each keeps its reason). `
                : ""}
              No email is sent. Eligibility is calculated for every stored prospect.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={pending}>
                Back to preview
              </Button>
            </DialogClose>
            <Button onClick={run} disabled={pending}>
              {pending ? "Importing…" : "Import now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
