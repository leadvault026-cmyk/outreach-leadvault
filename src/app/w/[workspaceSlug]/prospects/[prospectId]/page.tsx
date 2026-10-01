import { ArrowLeft, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { RESULT_ACTION_LABELS } from "@/components/imports/import-labels";
import { EligibilityBadge, VerificationBadge } from "@/components/prospects/badges";
import { StatusBadge } from "@/components/status-badge";
import { AddSuppressionDialog } from "@/components/suppression/suppression-dialogs";
import { systemDb, withUserContext } from "@/db/client";
import { REASONS, reasonExplanation, reasonLabel } from "@/domain/eligibility";
import { countryName, regionName } from "@/domain/geo";
import { can, canManageGlobalSuppression } from "@/domain/permissions";
import { isSafeHttpUrl } from "@/domain/prospects/normalize";
import { SUPPRESSION_REASON_LABELS, SUPPRESSION_SOURCE_LABELS } from "@/domain/suppression";
import { isUuid } from "@/lib/ids";
import { formatDateTime } from "@/lib/format";
import { getPageContext } from "@/server/page-context";
import { getMyProfile } from "@/server/profile";
import { refreshEligibility } from "@/services/eligibility-service";
import { getProspectDetail } from "@/services/prospect-query";

export const metadata: Metadata = { title: "Prospect" };

const DOMAIN_CLASS_LABELS = {
  BUSINESS: "Business domain (matches the website)",
  CONSUMER: "Consumer mailbox provider",
  UNKNOWN: "Not confirmed as the company's domain",
} as const;

const JURISDICTION_SOURCE: Record<string, string> = {
  workspace_region: "Workspace policy for this region",
  workspace_country: "Workspace policy for this country",
  global_region: "LeadVault policy for this region",
  global_country: "LeadVault policy for this country",
  default_review: "No policy configured — held for review",
  unknown_country: "Country unknown",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`s-${title}`} className="rounded-lg border bg-card">
      <h2 id={`s-${title}`} className="border-b px-4 py-2.5 text-sm font-semibold">
        {title}
      </h2>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

function Facts({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[minmax(8rem,auto)_1fr]">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words">
            {v ?? <span className="text-muted-foreground">—</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function SafeLink({ href, children }: { href: string | null; children: ReactNode }) {
  if (!href || !isSafeHttpUrl(href)) return <>{children}</>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="inline-flex items-center gap-1 break-all text-primary hover:underline"
    >
      {children}
      <ExternalLink aria-hidden className="size-3 shrink-0" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

export default async function ProspectDetailPage({
  params,
}: PageProps<"/w/[workspaceSlug]/prospects/[prospectId]">) {
  const ctx = await getPageContext(params);
  if (!ctx) return null;
  const { prospectId } = await params;
  if (!isUuid(prospectId)) notFound();
  const tz = ctx.workspace.defaultTimezone;
  const slug = ctx.workspace.slug;

  let detail = await withUserContext(ctx.user.userId, (tx) =>
    getProspectDetail(tx, ctx.workspace.id, prospectId),
  );
  if (!detail) notFound();

  // The live evaluation is authoritative. If the cached decision drifted (e.g. it aged out),
  // the cache is refreshed so lists and audiences agree with what this page shows.
  const cached = detail.state;
  const drifted =
    !cached ||
    cached.eligibility !== detail.live.status ||
    cached.eligibilityReasons.join(",") !== detail.live.reasons.join(",");
  if (drifted) {
    await refreshEligibility(systemDb(), ctx.workspace.id, { kind: "ids", ids: [prospectId] });
    detail = (await withUserContext(ctx.user.userId, (tx) =>
      getProspectDetail(tx, ctx.workspace.id, prospectId),
    ))!;
  }

  const { prospect: p, state, live, memberships, provenance } = detail;
  const canSuppress = can(ctx.role, "suppression.add");
  const canGlobal = canSuppress && canManageGlobalSuppression(await getMyProfile());
  const custom = Object.entries((p.customFields ?? {}) as Record<string, unknown>).filter(
    ([, v]) => v !== null && v !== "",
  );
  const websiteHref =
    p.website && isSafeHttpUrl(p.website)
      ? p.website
      : p.websiteDomain
        ? `https://${p.websiteDomain}`
        : null;

  return (
    <>
      <Link
        href={`/w/${slug}/prospects`}
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" /> Prospects
      </Link>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[22px] leading-tight font-semibold tracking-tight break-words">
              {p.companyName}
            </h1>
            <EligibilityBadge status={live.status} />
          </div>
          <p className="mt-1 text-sm break-words text-muted-foreground">
            {[p.contactName, p.contactTitle].filter(Boolean).join(" — ") || "No contact name"}
            {p.emailNormalized ? ` · ${p.emailNormalized}` : ""}
          </p>
        </div>
        {canSuppress && (p.emailNormalized || p.emailDomain) ? (
          <div className="flex flex-wrap gap-2">
            {p.emailNormalized ? (
              <AddSuppressionDialog
                workspaceSlug={slug}
                canGlobal={canGlobal}
                defaultValue={p.emailNormalized}
                defaultType="email"
                triggerLabel="Suppress this email"
                triggerVariant="outline"
              />
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-4">
          <Section title="Eligibility">
            <div className="flex flex-wrap items-center gap-2">
              <EligibilityBadge status={live.status} />
              <span className="text-xs text-muted-foreground">
                {state ? `Checked ${formatDateTime(state.eligibilityCheckedAt, tz)}` : null}
              </span>
            </div>
            {live.reasons.length ? (
              <ul className="mt-3 space-y-2">
                {live.reasons.map((code) => {
                  const sev = REASONS[code].severity;
                  return (
                    <li key={code} className="rounded-md border px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge
                          status={sev}
                          tone={sev === "review" ? "warning" : "danger"}
                          label={
                            sev === "review"
                              ? "Review"
                              : sev === "suppressed"
                                ? "Suppressed"
                                : "Blocks outreach"
                          }
                        />
                        <span className="text-sm font-medium">{reasonLabel(code)}</span>
                        <code className="text-[11px] text-muted-foreground">{code}</code>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {reasonExplanation(code)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-3 text-sm">
                Passes every eligibility rule. Nothing is sent until a campaign is launched (not
                available yet).
              </p>
            )}
            <div className="mt-4">
              <Facts
                items={[
                  [
                    "Jurisdiction",
                    <span key="j" className="inline-flex flex-wrap items-center gap-2">
                      <StatusBadge status={live.jurisdiction.outreachStatus} />
                      <span className="text-xs text-muted-foreground">
                        {JURISDICTION_SOURCE[live.jurisdiction.matchedBy]}
                      </span>
                    </span>,
                  ],
                  ["Email domain", DOMAIN_CLASS_LABELS[live.domainClass]],
                ]}
              />
            </div>
          </Section>

          <Section title="Company">
            <Facts
              items={[
                ["Company", p.companyName],
                [
                  "Website",
                  p.websiteDomain ? (
                    <SafeLink href={websiteHref}>{p.websiteDomain}</SafeLink>
                  ) : null,
                ],
                ["Business type", p.businessType],
                ["Phone", p.phone],
              ]}
            />
          </Section>

          <Section title="Contact">
            <Facts
              items={[
                ["Name", p.contactName],
                ["First / last", [p.firstName, p.lastName].filter(Boolean).join(" ") || null],
                ["Title", p.contactTitle],
                ["Email", p.email],
              ]}
            />
          </Section>

          <Section title="Location">
            <Facts
              items={[
                ["Address", p.addressLine],
                ["City", p.city],
                [
                  "State / region",
                  p.regionCode
                    ? `${regionName(p.regionCode) ?? p.state} (${p.regionCode})`
                    : p.state,
                ],
                ["Postal code", p.postalCode],
                [
                  "Country",
                  p.countryCode
                    ? `${countryName(p.countryCode) ?? p.countryCode} (${p.countryCode})`
                    : null,
                ],
              ]}
            />
          </Section>

          <Section title="Qualification">
            <Facts
              items={[
                ["Basis", p.qualificationBasis],
                [
                  "Evidence",
                  p.evidenceUrl ? <SafeLink href={p.evidenceUrl}>{p.evidenceUrl}</SafeLink> : null,
                ],
                ["Research reference", p.researchSourceRef],
                ...custom.map(([k, v]) => [k.replace(/_/g, " "), String(v)] as [string, ReactNode]),
              ]}
            />
          </Section>
        </div>

        <div className="space-y-4">
          <Section title="Email verification">
            <Facts
              items={[
                [
                  "Status",
                  <VerificationBadge
                    key="v"
                    status={p.emailVerificationStatus}
                    verifiedAt={p.emailVerifiedAt}
                  />,
                ],
                ["Verified on", p.emailVerifiedAt ? formatDateTime(p.emailVerifiedAt, tz) : null],
                ["Source", p.emailVerificationSource],
                ["Original label", p.emailVerificationDetail],
              ]}
            />
            <p className="mt-3 text-xs text-muted-foreground">
              Results older than 90 days count as stale. Unrecognised labels are never treated as
              verified.
            </p>
          </Section>

          <Section title="Audiences">
            {memberships.length ? (
              <ul className="space-y-1.5 text-sm">
                {memberships.map((m) => (
                  <li key={m.id} className="flex justify-between gap-2">
                    <Link
                      href={`/w/${slug}/audiences/${m.id}`}
                      className="truncate hover:underline"
                    >
                      {m.name}
                    </Link>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDateTime(m.addedAt, tz)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Not in any audience.</p>
            )}
          </Section>

          <Section title="Provenance">
            {provenance.length ? (
              <ul className="space-y-2 text-sm">
                {provenance.map((r) => (
                  <li key={`${r.importId}-${r.rowNumber}`}>
                    <Link
                      href={`/w/${slug}/imports/${r.importId}`}
                      className="font-medium hover:underline"
                    >
                      {r.label ?? r.fileName}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      Row {r.rowNumber} · {RESULT_ACTION_LABELS[r.outcome] ?? r.outcome}
                      {r.importedAt ? ` · ${formatDateTime(r.importedAt, tz)}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No import record.</p>
            )}
          </Section>

          <Section title="Activity">
            <ul className="space-y-2 text-sm">
              {detail.suppressionHistory.map((s) => (
                <li key={s.id}>
                  <p>
                    {s.liftedAt ? "Suppression lifted" : "Suppressed"} —{" "}
                    {SUPPRESSION_REASON_LABELS[s.reason] ?? s.reason}{" "}
                    <span className="text-muted-foreground">
                      ({s.scope === "global" ? "LeadVault-wide" : "workspace"}, {s.valueType}{" "}
                      {s.valueNormalized})
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {SUPPRESSION_SOURCE_LABELS[s.source] ?? s.source} ·{" "}
                    {formatDateTime(s.createdAt, tz)}
                    {s.liftedAt ? ` · lifted ${formatDateTime(s.liftedAt, tz)}` : ""}
                  </p>
                </li>
              ))}
              {detail.unsubscribeHistory.map((u) => (
                <li key={u.id}>
                  <p>Unsubscribed</p>
                  <p className="text-xs text-muted-foreground">
                    {u.method.replace(/_/g, " ")} · {formatDateTime(u.occurredAt, tz)}
                  </p>
                </li>
              ))}
              <li>
                <p>Last updated</p>
                <p className="text-xs text-muted-foreground">{formatDateTime(p.updatedAt, tz)}</p>
              </li>
              <li>
                <p>Added to the workspace</p>
                <p className="text-xs text-muted-foreground">{formatDateTime(p.createdAt, tz)}</p>
              </li>
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              No messages have been sent. Sending is not part of this release.
            </p>
          </Section>
        </div>
      </div>
    </>
  );
}
