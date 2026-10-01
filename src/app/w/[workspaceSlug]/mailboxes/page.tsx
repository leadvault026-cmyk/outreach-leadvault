import { Mail } from "lucide-react";
import type { Metadata } from "next";
import { TransportNotice, WorkerStatus } from "@/components/campaigns/system-notices";
import { MailboxSettingsDialog } from "@/components/mailboxes/mailbox-settings-dialog";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states/empty-state";
import { InlineAlert } from "@/components/states/inline-alert";
import { StatusBadge } from "@/components/status-badge";
import { withUserContext } from "@/db/client";
import { can } from "@/domain/permissions";
import { relativeTime } from "@/lib/format";
import { getPageContext } from "@/server/page-context";
import { lastWorkerBeat } from "@/server/queries/worker";
import { listMailboxes } from "@/services/mailbox-service";
import { sendConfig } from "@/services/send-config";

export const metadata: Metadata = { title: "Mailboxes" };

const PROVIDER_LABELS: Record<string, string> = {
  smtp_imap: "SMTP / IMAP",
  google_workspace: "Google Workspace",
  microsoft_365: "Microsoft 365",
};

export default async function MailboxesPage({ params }: PageProps<"/w/[workspaceSlug]/mailboxes">) {
  const ctx = await getPageContext(params);
  if (!ctx) return null;
  const list = await withUserContext(ctx.user.userId, (tx) => listMailboxes(tx, ctx.workspace.id));
  const canManage = can(ctx.role, "mailboxes.manage");
  const cfg = sendConfig();

  return (
    <>
      <PageHeader
        title="Mailboxes"
        description="The mailboxes campaigns send from, with their daily limits and health. Credentials are stored encrypted on the server and are never shown."
      />
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <TransportNotice transport={cfg.transport} />
        <WorkerStatus lastBeat={await lastWorkerBeat()} />
      </div>
      <InlineAlert tone="info" title="Connecting a new mailbox" className="mb-4">
        Real sending needs a mailbox provider (for example Mission Inbox or Infraforge) to be
        purchased and connected. That is a separate, controlled step; until then the mailboxes below
        are fictional and only the fake transport is used.
      </InlineAlert>
      {list.length === 0 ? (
        <EmptyState
          icon={Mail}
          title="No mailboxes"
          description="No sending mailbox is configured for this workspace."
          className="bg-card"
        />
      ) : (
        <ul className="space-y-3" aria-label="Mailboxes">
          {list.map((m) => {
            const pct = Math.min(100, Math.round((m.sentToday / m.dailySendLimit) * 100));
            return (
              <li key={m.id} className="rounded-lg border bg-card px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium break-all">
                      {m.displayName} &lt;{m.emailAddress}&gt;
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {PROVIDER_LABELS[m.provider ?? ""] ?? m.provider ?? "Unknown provider"} ·{" "}
                      {m.infraVendor === "demo" ? "demo mailbox" : m.infraVendor} · {m.timezone}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={m.status} />
                    {!m.enabled ? (
                      <StatusBadge status="disabled" tone="warning" label="Disabled" />
                    ) : null}
                    {canManage ? (
                      <MailboxSettingsDialog workspaceSlug={ctx.workspace.slug} mailbox={m} />
                    ) : null}
                  </div>
                </div>
                {m.statusReason ? (
                  <p className="mt-1 text-xs text-warning">{m.statusReason}</p>
                ) : null}
                <div className="mt-3 flex items-center gap-3">
                  <div
                    className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
                    role="meter"
                    aria-label={`${m.emailAddress} sent today`}
                    aria-valuemin={0}
                    aria-valuemax={m.dailySendLimit}
                    aria-valuenow={m.sentToday}
                  >
                    <div className="h-full rounded-full bg-chart-1" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="tabular text-xs whitespace-nowrap text-muted-foreground">
                    {m.sentToday}/{m.dailySendLimit} today
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {m.sentTotal.toLocaleString()} sent in total · {m.hardBounces} hard bounce
                  {m.hardBounces === 1 ? "" : "s"} · at least {m.minSecondsBetweenSends}s between
                  emails
                  {m.lastSendAt ? ` · last email ${relativeTime(m.lastSendAt)}` : ""}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
