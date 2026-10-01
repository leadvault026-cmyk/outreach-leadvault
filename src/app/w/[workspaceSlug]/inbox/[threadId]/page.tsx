import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RECIPIENT_STATUS_LABELS } from "@/domain/campaigns";
import { ClassifyButtons } from "@/components/inbox/classify-buttons";
import { CLASSIFICATION_LABELS, REPLY_KIND_LABELS } from "@/components/inbox/labels";
import { StatusBadge } from "@/components/status-badge";
import { withUserContext } from "@/db/client";
import { can } from "@/domain/permissions";
import { isUuid } from "@/lib/ids";
import { formatDateTime } from "@/lib/format";
import { getPageContext } from "@/server/page-context";
import { getThread, markThreadRead } from "@/services/inbox-service";

export const metadata: Metadata = { title: "Conversation" };

export default async function ThreadPage({
  params,
}: PageProps<"/w/[workspaceSlug]/inbox/[threadId]">) {
  const ctx = await getPageContext(params);
  if (!ctx) return null;
  const { threadId } = await params;
  if (!isUuid(threadId)) notFound();
  const canClassify = can(ctx.role, "inbox.classify");
  const t = await withUserContext(ctx.user.userId, async (tx) => {
    const found = await getThread(tx, ctx.workspace.id, threadId);
    if (found && canClassify) await markThreadRead(tx, ctx.workspace.id, threadId);
    return found;
  });
  if (!t) notFound();
  const slug = ctx.workspace.slug;
  const tz = ctx.workspace.defaultTimezone;
  const cl = CLASSIFICATION_LABELS[t.thread.classification];
  const rs = t.recipientStatus ? RECIPIENT_STATUS_LABELS[t.recipientStatus] : null;

  return (
    <>
      <Link
        href={`/w/${slug}/inbox`}
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" /> Inbox
      </Link>
      <div className="mb-5 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[22px] leading-tight font-semibold tracking-tight break-words">
            {t.thread.subject ?? "(no subject)"}
          </h1>
          <StatusBadge status={t.thread.classification} label={cl?.label} tone={cl?.tone} />
        </div>
        <p className="text-sm text-muted-foreground">
          {t.thread.prospectId ? (
            <Link href={`/w/${slug}/prospects/${t.thread.prospectId}`} className="hover:underline">
              {[t.contactName, t.companyName].filter(Boolean).join(" · ") || t.prospectEmail}
            </Link>
          ) : (
            "Unmatched sender"
          )}
          {t.thread.campaignId ? (
            <>
              {" · "}
              <Link
                href={`/w/${slug}/campaigns/${t.thread.campaignId}`}
                className="hover:underline"
              >
                {t.campaignName}
              </Link>
            </>
          ) : null}
        </p>
        {rs ? (
          <p className="text-xs text-muted-foreground">
            Sequence status for this prospect:{" "}
            <StatusBadge status={t.recipientStatus!} label={rs.label} tone={rs.tone} />
          </p>
        ) : null}
      </div>

      {canClassify ? (
        <section aria-label="Classification" className="mb-5 rounded-lg border bg-card px-4 py-3">
          <p className="mb-2 text-sm font-medium">How should this reply be counted?</p>
          <ClassifyButtons
            workspaceSlug={slug}
            threadId={t.thread.id}
            current={t.thread.classification}
          />
        </section>
      ) : null}

      <ol className="space-y-3" aria-label="Conversation">
        {t.conversation.map((m) => (
          <li
            key={`${m.direction}-${m.id}`}
            className={`rounded-lg border px-4 py-3 ${m.direction === "out" ? "bg-muted/40 sm:mr-10" : "bg-card sm:ml-10"}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {m.direction === "out"
                  ? `Sent by ${m.from}${m.stepNumber ? ` · step ${m.stepNumber}` : ""}`
                  : `${REPLY_KIND_LABELS[m.kind] ?? "Reply"} from ${m.from}`}
              </span>
              <time dateTime={m.at.toISOString()}>{formatDateTime(m.at, tz)}</time>
            </div>
            <p className="mt-1 text-sm font-medium">{m.subject}</p>
            <pre className="mt-2 font-sans text-sm leading-relaxed break-words whitespace-pre-wrap">
              {m.body ?? ""}
            </pre>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-xs text-muted-foreground">
        Replying from the app is not part of the MVP. Answer from the sending mailbox; its sent copy
        is kept there.
      </p>
    </>
  );
}
