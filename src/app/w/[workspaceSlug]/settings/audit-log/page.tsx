import { ScrollText } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states/empty-state";
import { PermissionDenied } from "@/components/states/status-states";
import { AUDIT_ACTION_LABELS } from "@/domain/audit";
import { can } from "@/domain/permissions";
import { formatDateTime } from "@/lib/format";
import { getPageContext } from "@/server/page-context";
import { loadAuditLog } from "@/server/queries/settings";

export const metadata: Metadata = { title: "Audit log" };

function describeMetadata(metadata: Record<string, unknown>): string {
  return Object.entries(metadata)
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
    .join(" · ");
}

export default async function AuditLogPage({
  params,
}: PageProps<"/w/[workspaceSlug]/settings/audit-log">) {
  const ctx = await getPageContext(params);
  if (!ctx) return null;
  if (!can(ctx.role, "audit.view")) {
    return (
      <PermissionDenied requirement="The audit log is available to workspace Admins and Owners." />
    );
  }
  const entries = await loadAuditLog(ctx);
  const tz = ctx.workspace.defaultTimezone;

  return (
    <>
      <PageHeader
        title="Audit log"
        description="An append-only record of important actions in this workspace. Entries cannot be edited or deleted, and never contain credentials or message content."
      />
      {entries.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="No audited actions yet"
          description="Campaign launches, pauses, suppression changes, imports and settings changes will be recorded here as those modules become active."
          className="bg-card"
        />
      ) : (
        <div className="rounded-lg border bg-card">
          <ul className="divide-y">
            {entries.map((e) => (
              <li
                key={e.id}
                className="grid gap-1 px-4 py-3 md:grid-cols-[200px_minmax(0,1fr)_minmax(0,1fr)] md:gap-4"
              >
                <time
                  className="tabular text-xs text-muted-foreground"
                  dateTime={e.createdAt.toISOString()}
                >
                  {formatDateTime(e.createdAt, tz)}
                </time>
                <p className="text-sm">
                  <span className="font-medium">{AUDIT_ACTION_LABELS[e.action] ?? e.action}</span>
                  <span className="text-muted-foreground"> · {e.actorEmail ?? e.actorType}</span>
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {describeMetadata(e.metadata as Record<string, unknown>) || e.entityType}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
