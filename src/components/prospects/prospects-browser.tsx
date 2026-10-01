"use client";

import { useRouter } from "next/navigation";
import type { ProspectFilters } from "@/domain/prospects/filters";
import { AddToAudienceDialog } from "./add-to-audience-dialog";
import { ProspectTable, type ProspectRow } from "./prospect-table";

/** Prospect list with selection and the "add to audience" bulk action. */
export function ProspectsBrowser({
  workspaceSlug,
  rows,
  total,
  filters,
  filterQuery,
  audiences,
  canManage,
}: {
  workspaceSlug: string;
  rows: ProspectRow[];
  total: number;
  filters: ProspectFilters;
  filterQuery: string;
  audiences: Array<{ id: string; name: string }>;
  canManage: boolean;
}) {
  const router = useRouter();
  const base = `/w/${workspaceSlug}/prospects`;
  return (
    <ProspectTable
      rows={rows}
      total={total}
      filters={filters}
      basePath={base}
      detailBase={base}
      selectable={canManage}
      renderBulk={(selection, clear) => (
        <AddToAudienceDialog
          workspaceSlug={workspaceSlug}
          selection={selection}
          filterQuery={filterQuery}
          audiences={audiences}
          onDone={() => {
            clear();
            router.refresh();
          }}
        />
      )}
    />
  );
}
