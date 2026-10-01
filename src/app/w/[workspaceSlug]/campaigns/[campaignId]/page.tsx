import { ArrowLeft, CheckCircle2, Circle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { CampaignControls, LaunchButton } from "@/components/campaigns/campaign-controls";
import { reasonText } from "@/components/campaigns/reason-text";
import { RecipientTestActions, ReviewActions } from "@/components/campaigns/recipient-actions";
import { SequenceEditor } from "@/components/campaigns/sequence-editor";
import { CampaignSettingsForm } from "@/components/campaigns/settings-form";
import { TransportNotice, WorkerStatus } from "@/components/campaigns/system-notices";
import { Pagination } from "@/components/pagination";
import { InlineAlert } from "@/components/states/inline-alert";
import { StatusBadge } from "@/components/status-badge";
import { systemDb, withUserContext } from "@/db/client";
import {
  CAMPAIGN_STATUS_LABELS,
  formatDelay,
  MESSAGE_STATUS_LABELS,
  RECIPIENT_STATUS_LABELS,
  zonedParts,
} from "@/domain/campaigns";
import { can } from "@/domain/permissions";
import { signUnsubscribeToken } from "@/domain/unsubscribe-token";
import { isUuid } from "@/lib/ids";
import { formatDateTime, relativeTime } from "@/lib/format";
import { campaignFormOptions } from "@/server/queries/campaign-form";
import { lastWorkerBeat } from "@/server/queries/worker";
import { getPageContext } from "@/server/page-context";
import {
  campaignResults,
  getCampaign,
  launchProblems,
  listRecipients,
  messagesNeedingReview,
  planEnrollment,
  previewMessages,
  RECIPIENT_FILTERS,
} from "@/services/campaign-service";
import { latestSentMessageId } from "@/services/inbound-service";
import { sendConfig, simulationAllowed } from "@/services/send-config";
import { listTemplates } from "@/services/template-service";

export const metadata: Metadata = { title: "Campaign" };

const TABS = [
  { key: "overview", label: "Results" },
  { key: "sequence", label: "Sequence" },
  { key: "settings", label: "Settings" },
  { key: "preview", label: "Preview & launch" },
  { key: "recipients", label: "Recipients" },
] as const;
type Tab = (typeof TABS)[number]["key"];

function Tile({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="tabular mt-0.5 text-lg font-semibold">{value.toLocaleString()}</p>
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

export default async function CampaignPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/campaigns/[campaignId]">) {
  const ctx = await getPageContext(params);
  if (!ctx) return null;
  const { campaignId } = await params;
  if (!isUuid(campaignId)) notFound();
  const sp = await searchParams;
  const slug = ctx.workspace.slug;
  const base = `/w/${slug}/campaigns/${campaignId}`;
  const found = await withUserContext(ctx.user.userId, (tx) =>
    getCampaign(tx, ctx.workspace.id, campaignId),
  );
  if (!found) notFound();
  const c = found.campaign;
  const isDraft = c.status === "DRAFT";
  const tab: Tab =
    (TABS.find((t) => t.key === sp.tab)?.key as Tab | undefined) ??
    (isDraft ? (found.steps.length ? "preview" : "sequence") : "overview");
  const canManage = can(ctx.role, "campaigns.manage");
  const cfg = sendConfig();
  const tz = c.timezone ?? ctx.workspace.defaultTimezone;
  const st = CAMPAIGN_STATUS_LABELS[c.status];

  const steps = [
    { done: true, label: "Settings" },
    {
      done: found.steps.length > 0,
      label: `Sequence (${found.steps.length} email${found.steps.length === 1 ? "" : "s"})`,
    },
    { done: !isDraft, label: "Preview & launch" },
  ];

  return (
    <>
      <Link
        href={`/w/${slug}/campaigns`}
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" /> Campaigns
      </Link>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[22px] leading-tight font-semibold tracking-tight break-words">
              {c.name}
            </h1>
            <StatusBadge status={c.status} label={st?.label} tone={st?.tone} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {found.audienceName ? `Audience: ${found.audienceName}` : "No audience"} ·{" "}
            {found.mailboxEmail
              ? `From ${found.mailboxName} <${found.mailboxEmail}>`
              : "No mailbox"}
            {c.pauseReason && c.status === "PAUSED" ? ` · ${c.pauseReason}` : ""}
          </p>
          {c.description ? (
            <p className="mt-1 text-sm text-muted-foreground">{c.description}</p>
          ) : null}
        </div>
        {canManage && !isDraft ? (
          <CampaignControls workspaceSlug={slug} campaignId={c.id} status={c.status} />
        ) : null}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <TransportNotice transport={cfg.transport} />
        {!isDraft ? <WorkerStatus lastBeat={await lastWorkerBeat()} /> : null}
      </div>

      {isDraft ? (
        <ol
          className="mb-4 flex flex-wrap gap-x-5 gap-y-2 text-sm"
          aria-label="Campaign setup progress"
        >
          {steps.map((s) => (
            <li key={s.label} className="inline-flex items-center gap-1.5">
              {s.done ? (
                <CheckCircle2 aria-hidden className="size-4 text-success" />
              ) : (
                <Circle aria-hidden className="size-4 text-muted-foreground" />
              )}
              <span className={s.done ? "" : "text-muted-foreground"}>{s.label}</span>
            </li>
          ))}
        </ol>
      ) : null}

      <nav aria-label="Campaign sections" className="mb-5 flex gap-1 overflow-x-auto border-b">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`${base}?tab=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap ${tab === t.key ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {sp.launched === "1" ? (
        <InlineAlert tone="success" className="mb-4" title="Campaign launched">
          The worker now sends due emails one at a time. Keep it running with{" "}
          <code>npm run worker</code>.
        </InlineAlert>
      ) : null}

      {tab === "overview" ? await Overview() : null}
      {tab === "sequence" ? await SequenceTab() : null}
      {tab === "settings" ? await SettingsTab() : null}
      {tab === "preview" ? await PreviewTab() : null}
      {tab === "recipients" ? await RecipientsTab() : null}
    </>
  );

  async function Overview() {
    const [r, review] = await withUserContext(
      ctx!.user.userId,
      async (tx) =>
        [
          await campaignResults(tx, ctx!.workspace.id, campaignId),
          await messagesNeedingReview(tx, ctx!.workspace.id, campaignId),
        ] as const,
    );
    if (isDraft)
      return (
        <InlineAlert tone="info" title="Not launched yet">
          Write the sequence, check the preview, then launch. Results appear here once emails are
          sent.
        </InlineAlert>
      );
    return (
      <div className="space-y-5">
        <section
          aria-label="Campaign results"
          className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5"
        >
          <Tile label="Recipients" value={r.recipients} />
          <Tile
            label="Emails sent"
            value={r.sent}
            hint={cfg.transport === "fake" ? "Fake transport" : undefined}
          />
          <Tile label="Replied" value={r.replied} />
          <Tile label="Positive replies" value={r.positive} hint="Marked Interested in the Inbox" />
          <Tile label="Bounced" value={r.bounced} />
          <Tile label="Unsubscribed" value={r.unsubscribed} />
          <Tile label="Suppressed / stopped" value={r.suppressed + r.stopped} />
          <Tile label="Finished sequence" value={r.completed} />
          <Tile label="Remaining" value={r.remaining} hint="Still waiting for a step" />
          <Tile label="Excluded at launch" value={r.excluded} />
        </section>
        <p className="text-xs text-muted-foreground">
          “Delivered” is not shown: no provider confirms delivery reliably. Replies, bounces and
          unsubscribes are the trustworthy signals.
        </p>
        {review.length ? (
          <Section title="Uncertain sends needing review">
            <p className="mb-3 text-sm text-muted-foreground">
              The provider did not clearly confirm these sends. They are never retried
              automatically, because the email may already exist. Check the mailbox&apos;s Sent
              folder, then record what happened.
            </p>
            <ul className="divide-y">
              {review.map((m) => (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                >
                  <span>
                    Step {m.stepNumber} to {m.toEmail}{" "}
                    <StatusBadge
                      status={m.status}
                      label={MESSAGE_STATUS_LABELS[m.status]?.label}
                      tone={MESSAGE_STATUS_LABELS[m.status]?.tone}
                    />
                  </span>
                  {can(ctx!.role, "sends.resolve") ? (
                    <ReviewActions workspaceSlug={slug} campaignId={campaignId} messageId={m.id} />
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      An Admin can resolve this.
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
        <Section title="Schedule">
          <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted-foreground">Start</dt>
            <dd>{c.startAt ? formatDateTime(c.startAt, tz) : "When launched"}</dd>
            <dt className="text-muted-foreground">Sending window</dt>
            <dd>
              {c.windowStart && c.windowEnd
                ? `${(c.sendDays ?? []).map((d) => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d - 1]).join(", ")} · ${c.windowStart.slice(0, 5)}–${c.windowEnd.slice(0, 5)} (${tz})`
                : "Any day and time"}
            </dd>
            <dt className="text-muted-foreground">Daily limit</dt>
            <dd>
              {c.dailyLimit
                ? `${c.dailyLimit} per day (plus the mailbox limit)`
                : "Mailbox limit only"}
            </dd>
            <dt className="text-muted-foreground">Launched</dt>
            <dd>{c.launchedAt ? formatDateTime(c.launchedAt, tz) : "—"}</dd>
          </dl>
        </Section>
      </div>
    );
  }

  async function SequenceTab() {
    const templates = await withUserContext(ctx!.user.userId, (tx) =>
      listTemplates(tx, ctx!.workspace.id),
    );
    if (isDraft && canManage)
      return (
        <SequenceEditor
          workspaceSlug={slug}
          campaignId={campaignId}
          initial={found!.steps.map((s) => ({
            subject: s.subject,
            body: s.body,
            delayMinutes: s.delayMinutes,
            sourceTemplateId: s.sourceTemplateId,
          }))}
          templates={templates.map((t) => ({
            id: t.id,
            name: t.name,
            subject: t.subject,
            body: t.body,
          }))}
        />
      );
    return (
      <div className="max-w-3xl space-y-3">
        {!isDraft ? (
          <p className="text-sm text-muted-foreground">
            The sequence is locked once a campaign is launched; emails already sent are stored as
            sent.
          </p>
        ) : null}
        {found!.steps.length === 0 ? (
          <p className="text-sm text-muted-foreground">No emails yet.</p>
        ) : null}
        {found!.steps.map((s) => (
          <Section
            key={s.id}
            title={`Step ${s.stepNumber}${s.stepNumber > 1 ? ` — ${formatDelay(s.delayMinutes)} after the previous email` : " — first email"}`}
          >
            <p className="text-sm">
              <span className="text-muted-foreground">Subject: </span>
              {s.subject ?? "(reply in the same thread)"}
            </p>
            <pre className="mt-2 font-sans text-sm whitespace-pre-wrap">{s.body}</pre>
          </Section>
        ))}
      </div>
    );
  }

  async function SettingsTab() {
    const options = await campaignFormOptions(ctx!);
    const start = c.startAt ? zonedParts(c.startAt, tz) : null;
    return (
      <CampaignSettingsForm
        workspaceSlug={slug}
        campaignId={campaignId}
        editable={isDraft && canManage}
        saved={sp.saved === "1"}
        audiences={options.audiences}
        mailboxes={options.mailboxes}
        timezones={options.timezones}
        defaults={{
          name: c.name,
          description: c.description ?? "",
          audienceId: c.audienceId ?? "",
          mailboxId: c.mailboxId ?? "",
          timezone: tz,
          startMode: c.startAt && isDraft ? "at" : "launch",
          startDate: start?.date ?? "",
          startTime: start
            ? `${String(start.hour).padStart(2, "0")}:${String(start.minute).padStart(2, "0")}`
            : "09:00",
          anyTime: !c.windowStart,
          sendDays: c.sendDays ?? [1, 2, 3, 4, 5],
          windowStart: c.windowStart?.slice(0, 5) ?? "08:00",
          windowEnd: c.windowEnd?.slice(0, 5) ?? "17:00",
          dailyLimit: c.dailyLimit ? String(c.dailyLimit) : "",
        }}
      />
    );
  }

  async function PreviewTab() {
    // Planning re-evaluates eligibility (a cache write), so it runs on the system path after the
    // page has verified workspace access.
    const sys = systemDb();
    const enabled = found!.steps.filter((s) => s.enabled);
    const plan = await planEnrollment(sys, c, enabled);
    const problems = await launchProblems(
      sys,
      ctx!.workspace.id,
      {
        mailboxId: c.mailboxId,
        mailboxStatus: found!.mailboxStatus,
        mailboxEnabled: found!.mailboxEnabled,
      },
      {
        unsubscribeConfigured: Boolean(cfg.unsubscribeSecret && cfg.unsubscribeSecret.length >= 32),
      },
    );
    const enrolled = plan.recipients.filter((r) => r.decision === "enroll");
    const chosen =
      typeof sp.p === "string" && enrolled.some((r) => r.prospectId === sp.p)
        ? sp.p
        : enrolled[0]?.prospectId;
    const samples = chosen ? await previewMessages(sys, c, enabled, [chosen]) : [];
    const sample = samples[0];
    const excluded = plan.recipients.filter((r) => r.decision === "excluded");
    const groups = new Map<string, number>();
    for (const r of excluded)
      for (const code of r.reasons.length ? r.reasons : [r.category])
        groups.set(code, (groups.get(code) ?? 0) + 1);
    const blockers = [...problems, ...plan.blockers];
    const startsLater = Boolean(c.startAt && c.startAt > new Date());

    return (
      <div className="space-y-5">
        <section
          aria-label="Who will receive this campaign"
          className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7"
        >
          <Tile label="Audience members" value={plan.members} />
          <Tile label="Will receive" value={plan.counts.enroll} />
          <Tile label="Review required" value={plan.counts.NEEDS_REVIEW} />
          <Tile label="Ineligible" value={plan.counts.INELIGIBLE} />
          <Tile label="Suppressed" value={plan.counts.SUPPRESSED} />
          <Tile label="Missing personalization" value={plan.counts.MISSING_VARIABLE} />
          <Tile label="In another running campaign" value={plan.counts.ALREADY_ACTIVE} />
        </section>

        {blockers.length ? (
          <InlineAlert tone="warning" title="Not ready to launch">
            <ul className="list-disc pl-4">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </InlineAlert>
        ) : null}

        {isDraft && canManage ? (
          <LaunchButton
            workspaceSlug={slug}
            campaignId={campaignId}
            enroll={plan.counts.enroll}
            excluded={plan.counts.excluded}
            startsLater={startsLater}
            transport={cfg.transport}
            disabled={blockers.length > 0}
          />
        ) : !isDraft ? (
          <p className="text-sm text-muted-foreground">
            This campaign has been launched. The figures above show how its audience would be
            evaluated today.
          </p>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Section
            title="Personalized preview"
            action={
              enrolled.length > 1 ? (
                <form method="get" action={base} className="flex items-center gap-2">
                  <input type="hidden" name="tab" value="preview" />
                  <label htmlFor="pv-p" className="sr-only">
                    Preview recipient
                  </label>
                  <select
                    id="pv-p"
                    name="p"
                    defaultValue={chosen}
                    className="h-8 max-w-56 rounded-md border bg-background px-2 text-xs"
                  >
                    {enrolled.slice(0, 50).map((r) => (
                      <option key={r.prospectId} value={r.prospectId}>
                        {r.companyName}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="h-8 rounded-md border px-2 text-xs hover:bg-muted"
                  >
                    Show
                  </button>
                </form>
              ) : null
            }
          >
            {!sample ? (
              <p className="text-sm text-muted-foreground">
                {enabled.length
                  ? "No recipient can receive this campaign yet, so there is nothing to preview."
                  : "Write the sequence first."}
              </p>
            ) : (
              <div className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  To: {sample.contactName ? `${sample.contactName}, ` : ""}
                  {sample.companyName} &lt;{sample.email}&gt;
                </p>
                {sample.messages.map((m, i) => (
                  <article key={i} className="rounded-md border px-3 py-2">
                    <p className="text-xs text-muted-foreground">
                      Step {i + 1}
                      {i > 0
                        ? ` · ${formatDelay(enabled[i]!.delayMinutes)} after the previous email`
                        : ""}
                    </p>
                    <p className="mt-1 text-sm font-medium">{m.subject}</p>
                    <pre className="mt-2 font-sans text-sm leading-relaxed whitespace-pre-wrap">
                      {m.body}
                    </pre>
                  </article>
                ))}
              </div>
            )}
          </Section>
          <Section title="Who is left out, and why">
            {groups.size === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nobody — every audience member can be contacted.
              </p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {[...groups.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .map(([code, count]) => (
                    <li key={code} className="flex justify-between gap-3">
                      <span>{reasonText(code)}</span>
                      <span className="tabular text-muted-foreground">
                        {count.toLocaleString()}
                      </span>
                    </li>
                  ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              A prospect can have several reasons. Review-required prospects are never sent to
              automatically.
            </p>
          </Section>
        </div>
      </div>
    );
  }

  async function RecipientsTab() {
    const filter = (RECIPIENT_FILTERS as readonly string[]).includes(String(sp.filter))
      ? (sp.filter as (typeof RECIPIENT_FILTERS)[number])
      : "all";
    const page = Math.max(1, Math.min(10_000, Number(sp.page) || 1));
    const list = await withUserContext(ctx!.user.userId, (tx) =>
      listRecipients(tx, ctx!.workspace.id, campaignId, filter, page),
    );
    const allowSim = simulationAllowed(cfg) && canManage;
    const secret = cfg.unsubscribeSecret;
    const tokenFor = async (recipientId: string) => {
      if (!secret || secret.length < 32) return null;
      const id = await latestSentMessageId(systemDb(), ctx!.workspace.id, recipientId);
      return id ? `/u/${signUnsubscribeToken(id, secret)}` : null;
    };
    const unsubLinks = allowSim ? await Promise.all(list.rows.map((r) => tokenFor(r.id))) : [];
    const FILTER_LABELS = {
      all: "All",
      live: "Waiting / sending",
      replied: "Replied",
      stopped: "Stopped",
      excluded: "Excluded",
    } as const;

    return (
      <div className="space-y-3">
        <nav aria-label="Filter recipients" className="flex flex-wrap gap-2 text-sm">
          {RECIPIENT_FILTERS.map((f) => (
            <Link
              key={f}
              href={`${base}?tab=recipients&filter=${f}`}
              aria-current={filter === f ? "page" : undefined}
              className={`rounded-md border px-2.5 py-1 ${filter === f ? "border-primary bg-primary/10 font-medium" : "bg-card text-muted-foreground hover:text-foreground"}`}
            >
              {FILTER_LABELS[f]}
            </Link>
          ))}
        </nav>
        {allowSim ? (
          <p className="text-xs text-muted-foreground">
            “Test” simulates what a real mailbox would receive (a reply, a bounce…). It runs through
            the same processing as real events. Available with the fake transport only.
          </p>
        ) : null}
        {list.rows.length === 0 ? (
          <p className="rounded-lg border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
            {isDraft
              ? "Recipients are created when the campaign is launched."
              : "No recipients in this view."}
          </p>
        ) : (
          <ul
            className="divide-y overflow-hidden rounded-lg border bg-card"
            aria-label="Recipients"
          >
            {list.rows.map((r, i) => {
              const s = RECIPIENT_STATUS_LABELS[r.status];
              const reason =
                r.status === "EXCLUDED"
                  ? (r.excludedReasons ?? []).map(reasonText).join("; ")
                  : reasonText(r.stopReason);
              return (
                <li
                  key={r.id}
                  className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/w/${slug}/prospects/${r.prospectId}`}
                      className="font-medium hover:underline"
                    >
                      {r.companyName}
                    </Link>
                    <p className="text-sm break-all text-muted-foreground">
                      {r.contactName ? `${r.contactName} · ` : ""}
                      {r.email || "No email"}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <StatusBadge status={r.status} label={s?.label} tone={s?.tone} />
                      {r.lastSentStep ? (
                        <span>
                          {r.lastSentStep} of {found!.steps.length} sent
                        </span>
                      ) : null}
                      {r.status === "SCHEDULED" && r.nextSendAt ? (
                        <span>
                          Step {r.nextStep} due{" "}
                          {r.nextSendAt > new Date() ? relativeTime(r.nextSendAt) : "now"}
                        </span>
                      ) : null}
                      {reason ? <span>{reason}</span> : null}
                    </div>
                  </div>
                  {allowSim && r.lastMessageId ? (
                    <RecipientTestActions
                      workspaceSlug={slug}
                      campaignId={campaignId}
                      recipientId={r.id}
                      label={r.companyName}
                      unsubscribeHref={unsubLinks[i] ?? null}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <Pagination
          page={page}
          size={50}
          total={list.total}
          hrefFor={(p) => `${base}?tab=recipients&filter=${filter}&page=${p}`}
        />
      </div>
    );
  }
}
