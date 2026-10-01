import { ListChecks } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AudienceFormDialog } from "@/components/audiences/audience-form-dialog";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states/empty-state";
import { Button } from "@/components/ui/button";
import { systemDb, withUserContext } from "@/db/client";
import { ELIGIBILITY_LABELS } from "@/domain/eligibility";
import { can } from "@/domain/permissions";
import { relativeTime } from "@/lib/format";
import { getPageContext } from "@/server/page-context";
import { listAudiences } from "@/services/audience-service";
import { refreshExpiredEligibility } from "@/services/eligibility-service";

export const metadata: Metadata = { title: "Audiences" };

export default async function AudiencesPage({ params }: PageProps<"/w/[workspaceSlug]/audiences">) {
  const ctx = await getPageContext(params);
  if (!ctx) return null;
  const slug = ctx.workspace.slug;
  await refreshExpiredEligibility(systemDb(), ctx.workspace.id);
  const audiences = await withUserContext(ctx.user.userId, (tx) =>
    listAudiences(tx, ctx.workspace.id),
  );
  const canManage = can(ctx.role, "audiences.manage");

  return (
    <>
      <PageHeader
        title="Audiences"
        description="Saved groups of prospects for future campaigns. Membership never overrides suppression or eligibility — every member is re-checked before any contact."
        actions={canManage ? <AudienceFormDialog workspaceSlug={slug} /> : null}
      />
      {audiences.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="No audiences yet"
          description="Filter prospects, select them, and choose “Add to audience” — or create an empty audience here."
          className="bg-card"
          action={
            <Button variant="outline" asChild>
              <Link href={`/w/${slug}/prospects`}>Go to prospects</Link>
            </Button>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <table className="hidden w-full text-sm md:table">
            <caption className="sr-only">Audiences</caption>
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                <th scope="col" className="px-4 py-2 font-medium">
                  Audience
                </th>
                <th scope="col" className="px-2 py-2 text-right font-medium">
                  Members
                </th>
                <th scope="col" className="px-2 py-2 text-right font-medium">
                  {ELIGIBILITY_LABELS.ELIGIBLE}
                </th>
                <th scope="col" className="px-2 py-2 text-right font-medium">
                  {ELIGIBILITY_LABELS.NEEDS_REVIEW}
                </th>
                <th scope="col" className="px-2 py-2 text-right font-medium">
                  Not contactable
                </th>
                <th scope="col" className="px-2 py-2 pr-4 font-medium">
                  Updated
                </th>
              </tr>
            </thead>
            <tbody>
              {audiences.map((a) => (
                <tr key={a.id} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/w/${slug}/audiences/${a.id}`}
                      className="font-medium hover:underline"
                    >
                      {a.name}
                    </Link>
                    {a.description ? (
                      <p className="line-clamp-1 text-xs text-muted-foreground">{a.description}</p>
                    ) : null}
                  </td>
                  <td className="tabular px-2 py-2.5 text-right">
                    {a.counts.total.toLocaleString()}
                  </td>
                  <td className="tabular px-2 py-2.5 text-right">
                    {a.counts.ELIGIBLE.toLocaleString()}
                  </td>
                  <td className="tabular px-2 py-2.5 text-right">
                    {a.counts.NEEDS_REVIEW.toLocaleString()}
                  </td>
                  <td className="tabular px-2 py-2.5 text-right">
                    {(
                      a.counts.INELIGIBLE +
                      a.counts.SUPPRESSED +
                      a.counts.unknown
                    ).toLocaleString()}
                  </td>
                  <td className="px-2 py-2.5 pr-4 text-xs whitespace-nowrap text-muted-foreground">
                    {relativeTime(a.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="divide-y md:hidden" aria-label="Audiences">
            {audiences.map((a) => (
              <li key={a.id} className="px-4 py-3">
                <Link
                  href={`/w/${slug}/audiences/${a.id}`}
                  className="font-medium break-words hover:underline"
                >
                  {a.name}
                </Link>
                <p className="tabular mt-1 text-xs text-muted-foreground">
                  {a.counts.total.toLocaleString()} members · {a.counts.ELIGIBLE.toLocaleString()}{" "}
                  eligible · {a.counts.NEEDS_REVIEW.toLocaleString()} review
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
