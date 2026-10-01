import { Upload } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { IMPORT_STATUS } from "@/components/imports/import-labels";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { withUserContext } from "@/db/client";
import { can } from "@/domain/permissions";
import { formatDateTime } from "@/lib/format";
import { getPageContext } from "@/server/page-context";
import { listImports } from "@/services/import-service";

export const metadata: Metadata = { title: "Imports" };

export default async function ImportsPage({ params }: PageProps<"/w/[workspaceSlug]/imports">) {
  const ctx = await getPageContext(params);
  if (!ctx) return null;
  const imports = await withUserContext(ctx.user.userId, (tx) => listImports(tx, ctx.workspace.id));
  const slug = ctx.workspace.slug;
  const tz = ctx.workspace.defaultTimezone;
  const canImport = can(ctx.role, "prospects.manage");

  return (
    <>
      <PageHeader
        title="Imports"
        description="CSV imports of approved LeadVault research. Every import keeps a row-by-row record of what happened and why."
        actions={
          canImport ? (
            <Button asChild>
              <Link href={`/w/${slug}/imports/new`}>
                <Upload /> New import
              </Link>
            </Button>
          ) : null
        }
      />
      {imports.length === 0 ? (
        <EmptyState
          icon={Upload}
          title="No imports yet"
          description="Upload a CSV of approved prospects to start. You map its columns, preview every row, and only then import."
          className="bg-card"
          action={
            canImport ? (
              <Button asChild>
                <Link href={`/w/${slug}/imports/new`}>Start an import</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <table className="hidden w-full text-sm lg:table">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                <th scope="col" className="px-4 py-2 font-medium">
                  Import
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  Status
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  Created by
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  Started
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  Completed
                </th>
                <th scope="col" className="px-2 py-2 text-right font-medium">
                  Rows
                </th>
                <th scope="col" className="px-2 py-2 text-right font-medium">
                  Imported
                </th>
                <th scope="col" className="px-2 py-2 text-right font-medium">
                  Updated
                </th>
                <th scope="col" className="px-2 py-2 text-right font-medium">
                  Skipped
                </th>
                <th scope="col" className="px-2 py-2 text-right font-medium">
                  Review
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Failed
                </th>
              </tr>
            </thead>
            <tbody className="tabular">
              {imports.map((i) => {
                const st = IMPORT_STATUS[i.status] ?? { label: i.status, tone: "neutral" as const };
                return (
                  <tr key={i.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="max-w-[280px] px-4 py-2.5">
                      <Link
                        href={`/w/${slug}/imports/${i.id}`}
                        className="block truncate font-medium underline-offset-2 hover:underline"
                      >
                        {i.sourceLabel ?? i.fileName}
                      </Link>
                      <span className="block truncate text-xs text-muted-foreground">
                        {i.fileName}
                      </span>
                    </td>
                    <td className="px-2 py-2.5">
                      <StatusBadge status={i.status} label={st.label} tone={st.tone} />
                    </td>
                    <td className="max-w-[180px] truncate px-2 py-2.5 text-xs">
                      {i.creatorEmail ?? "—"}
                    </td>
                    <td className="px-2 py-2.5 text-xs">
                      {i.startedAt ? formatDateTime(i.startedAt, tz) : "—"}
                    </td>
                    <td className="px-2 py-2.5 text-xs">
                      {i.completedAt ? formatDateTime(i.completedAt, tz) : "—"}
                    </td>
                    <td className="px-2 py-2.5 text-right">{i.rowCount ?? "—"}</td>
                    <td className="px-2 py-2.5 text-right">{i.createdCount}</td>
                    <td className="px-2 py-2.5 text-right">{i.updatedCount}</td>
                    <td className="px-2 py-2.5 text-right">
                      {i.duplicateCount + i.skippedCount + i.unchangedCount}
                    </td>
                    <td className="px-2 py-2.5 text-right">{i.reviewCount}</td>
                    <td className="px-4 py-2.5 text-right">{i.invalidCount + i.errorCount}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <ul className="divide-y lg:hidden">
            {imports.map((i) => {
              const st = IMPORT_STATUS[i.status] ?? { label: i.status, tone: "neutral" as const };
              return (
                <li key={i.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/w/${slug}/imports/${i.id}`}
                      className="min-w-0 text-sm font-medium underline-offset-2 hover:underline"
                    >
                      {i.sourceLabel ?? i.fileName}
                    </Link>
                    <StatusBadge status={i.status} label={st.label} tone={st.tone} />
                  </div>
                  <p className="tabular mt-1 text-xs text-muted-foreground">
                    {i.rowCount ?? 0} rows · {i.createdCount} imported · {i.updatedCount} updated ·{" "}
                    {i.reviewCount} review · {i.invalidCount + i.errorCount} failed
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(i.createdAt, tz)} · {i.creatorEmail ?? "—"}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}
