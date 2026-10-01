import { Inbox } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CLASSIFICATION_LABELS } from "@/components/inbox/labels";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { EmptyState } from "@/components/states/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { withUserContext } from "@/db/client";
import { relativeTime } from "@/lib/format";
import { getPageContext } from "@/server/page-context";
import { INBOX_FILTERS, listThreads, type InboxFilter } from "@/services/inbox-service";

export const metadata: Metadata = { title: "Inbox" };

const FILTER_LABELS: Record<InboxFilter, string> = {
  all: "All",
  unread: "Unread",
  ...Object.fromEntries(Object.entries(CLASSIFICATION_LABELS).map(([k, v]) => [k, v.label])),
} as Record<InboxFilter, string>;

export default async function InboxPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/inbox">) {
  const ctx = await getPageContext(params);
  if (!ctx) return null;
  const sp = await searchParams;
  const filter = (INBOX_FILTERS as readonly string[]).includes(String(sp.filter))
    ? (sp.filter as InboxFilter)
    : "all";
  const page = Math.max(1, Math.min(10_000, Number(sp.page) || 1));
  const slug = ctx.workspace.slug;
  const base = `/w/${slug}/inbox`;
  const { total, rows } = await withUserContext(ctx.user.userId, (tx) =>
    listThreads(tx, ctx.workspace.id, filter, page),
  );

  return (
    <>
      <PageHeader
        title="Inbox"
        description="Replies to your campaigns, one row per conversation. A reply stops that prospect's remaining sequence automatically; out-of-office replies do not."
      />
      <nav aria-label="Filter conversations" className="mb-4 flex flex-wrap gap-2 text-sm">
        {INBOX_FILTERS.map((f) => (
          <Link
            key={f}
            href={f === "all" ? base : `${base}?filter=${f}`}
            aria-current={filter === f ? "page" : undefined}
            className={`rounded-md border px-2.5 py-1 ${filter === f ? "border-primary bg-primary/10 font-medium" : "bg-card text-muted-foreground hover:text-foreground"}`}
          >
            {FILTER_LABELS[f]}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={filter === "all" ? "No replies yet" : "Nothing here"}
          description="Replies appear here once a campaign has sent emails and prospects answer. With the fake transport, use a recipient's Test menu on the campaign page to simulate one."
          className="bg-card"
        />
      ) : (
        <div className="space-y-4">
          <ul
            className="divide-y overflow-hidden rounded-lg border bg-card"
            aria-label="Conversations"
          >
            {rows.map((t) => {
              const cl = CLASSIFICATION_LABELS[t.classification];
              return (
                <li key={t.id}>
                  <Link
                    href={`${base}/${t.id}`}
                    className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 hover:bg-muted/40"
                  >
                    <div className="min-w-0 flex-1">
                      <p
                        className={`truncate text-sm ${t.isUnread ? "font-semibold" : "font-medium"}`}
                      >
                        {t.isUnread ? <span className="sr-only">Unread: </span> : null}
                        {t.contactName ?? t.latestFrom ?? "Unknown sender"}
                        {t.companyName ? (
                          <span className="font-normal text-muted-foreground">
                            {" "}
                            · {t.companyName}
                          </span>
                        ) : null}
                      </p>
                      <p className="truncate text-sm">{t.subject ?? "(no subject)"}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {t.latestSnippet ?? ""}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t.campaignName ?? "Not matched to a campaign"}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <StatusBadge status={t.classification} label={cl?.label} tone={cl?.tone} />
                      <span className="text-xs whitespace-nowrap text-muted-foreground">
                        {relativeTime(t.lastMessageAt)}
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
          <Pagination
            page={page}
            size={50}
            total={total}
            hrefFor={(p) => `${base}?filter=${filter}&page=${p}`}
          />
        </div>
      )}
    </>
  );
}
