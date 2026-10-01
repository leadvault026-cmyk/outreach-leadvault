"use client";

import { UserMinus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { removeMembersAction } from "@/app/w/[workspaceSlug]/audiences/actions";
import {
  ProspectTable,
  type ProspectRow,
  type TableSelection,
} from "@/components/prospects/prospect-table";
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
import type { ProspectFilters } from "@/domain/prospects/filters";

/** Audience members (the shared prospect table filtered to this audience) with removal. */
export function AudienceMembers({
  workspaceSlug,
  audienceId,
  rows,
  total,
  filters,
  canManage,
}: {
  workspaceSlug: string;
  audienceId: string;
  rows: ProspectRow[];
  total: number;
  filters: ProspectFilters;
  canManage: boolean;
}) {
  return (
    <ProspectTable
      rows={rows}
      total={total}
      filters={filters}
      basePath={`/w/${workspaceSlug}/audiences/${audienceId}`}
      detailBase={`/w/${workspaceSlug}/prospects`}
      selectable={canManage}
      allowSelectAllMatching={false}
      renderBulk={(selection, clear) => (
        <RemoveButton
          workspaceSlug={workspaceSlug}
          audienceId={audienceId}
          selection={selection}
          onDone={clear}
        />
      )}
    />
  );
}

function RemoveButton({
  workspaceSlug,
  audienceId,
  selection,
  onDone,
}: {
  workspaceSlug: string;
  audienceId: string;
  selection: TableSelection;
  onDone: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ids = selection.mode === "ids" ? selection.ids : [];
  const n = ids.length;
  const run = () =>
    start(async () => {
      setError(null);
      const res = await removeMembersAction(workspaceSlug, { audienceId, ids });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      onDone();
      router.refresh();
    });
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={n === 0}>
        <UserMinus /> Remove from audience
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Remove {n.toLocaleString()} member{n === 1 ? "" : "s"}?
            </DialogTitle>
            <DialogDescription>
              They are removed from this audience only. The prospects themselves are not changed or
              deleted.
            </DialogDescription>
          </DialogHeader>
          {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={run} disabled={pending}>
              {pending ? "Removing…" : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
