import { Globe2 } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states/empty-state";
import { InlineAlert } from "@/components/states/inline-alert";
import { StatusBadge } from "@/components/status-badge";
import { getPageContext } from "@/server/page-context";
import { loadJurisdictionPolicies } from "@/server/queries/settings";

export const metadata: Metadata = { title: "Compliance" };

export default async function CompliancePage({
  params,
}: PageProps<"/w/[workspaceSlug]/settings/compliance">) {
  const ctx = await getPageContext(params);
  if (!ctx) return null;
  const policies = await loadJurisdictionPolicies(ctx);
  const allowedCount = policies.filter((p) => p.outreachStatus === "allowed").length;

  return (
    <>
      <PageHeader
        title="Compliance"
        description="Jurisdiction policies decide where outreach may be sent, and what each email must include. LeadVault Outreach is not limited to one country: every prospect carries a country and, where known, a region."
      />
      <div className="max-w-4xl space-y-6">
        <InlineAlert tone="info" title="Fail-closed by default">
          A country or region with no policy, or a prospect with no country, resolves to{" "}
          <strong>Review</strong> and is held from sending. Only an explicit <strong>Allowed</strong>{" "}
          policy makes a jurisdiction sendable. Precedence: workspace region → workspace country →
          LeadVault-wide region → LeadVault-wide country → Review.
        </InlineAlert>

        <section aria-labelledby="policies-heading" className="bg-card rounded-lg border">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <h2 id="policies-heading" className="text-sm font-semibold">
              Configured jurisdictions
            </h2>
            <span className="text-muted-foreground text-xs">
              {allowedCount} allowed · {policies.length} configured
            </span>
          </div>
          {policies.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={Globe2}
                headingLevel={3}
                title="No jurisdictions configured"
                description="No country is approved for live outreach. Every prospect currently resolves to Review. Policies are set by the owner with legal counsel before the first live campaign."
              />
            </div>
          ) : (
            <ul className="divide-y">
              {policies.map((p) => (
                <li key={p.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {p.regionCode ?? p.countryCode}{" "}
                      <span className="text-muted-foreground font-normal">
                        · {p.scope === "global" ? "LeadVault-wide" : "This workspace"}
                      </span>
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {p.requiresPostalAddress ? "Postal address required" : "Postal address optional"} ·{" "}
                      {p.requiresUnsubscribeLink ? "Unsubscribe link required" : "Unsubscribe link optional"}
                    </p>
                    {p.notes ? <p className="text-muted-foreground mt-1 text-xs">{p.notes}</p> : null}
                  </div>
                  <StatusBadge status={p.outreachStatus} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
