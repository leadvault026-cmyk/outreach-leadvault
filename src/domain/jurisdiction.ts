import type { OutreachPolicyStatus } from "./enums";

/**
 * Jurisdiction policy resolution (architecture §10). Pure: callers load candidate policy rows.
 * Precedence: workspace country+region → workspace country → global country+region →
 * global country → default REVIEW. It fails closed: unknown or unconfigured jurisdictions are
 * never sendable.
 */
export type PolicyRow = {
  scope: "global" | "workspace";
  workspaceId: string | null;
  countryCode: string;
  regionCode: string | null;
  outreachStatus: OutreachPolicyStatus;
  requiresPostalAddress: boolean;
  requiresUnsubscribeLink: boolean;
  footerTemplate: string | null;
};

export type ResolvedPolicy = {
  outreachStatus: OutreachPolicyStatus;
  requiresPostalAddress: boolean;
  requiresUnsubscribeLink: boolean;
  footerTemplate: string | null;
  matchedBy:
    | "workspace_region"
    | "workspace_country"
    | "global_region"
    | "global_country"
    | "default_review"
    | "unknown_country";
  reason?: "COUNTRY_UNKNOWN" | "JURISDICTION_REVIEW" | "JURISDICTION_BLOCKED";
};

const DEFAULT_REVIEW = {
  outreachStatus: "review",
  requiresPostalAddress: true,
  requiresUnsubscribeLink: true,
  footerTemplate: null,
} as const satisfies Omit<ResolvedPolicy, "matchedBy">;

function normalizeCountry(code: string | null | undefined): string | null {
  const c = code?.trim().toUpperCase();
  return c && /^[A-Z]{2}$/.test(c) ? c : null;
}

function normalizeRegion(code: string | null | undefined): string | null {
  const r = code?.trim().toUpperCase();
  return r && /^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(r) ? r : null;
}

function withReason(policy: Omit<ResolvedPolicy, "reason">): ResolvedPolicy {
  if (policy.outreachStatus === "blocked") return { ...policy, reason: "JURISDICTION_BLOCKED" };
  if (policy.outreachStatus === "review") return { ...policy, reason: "JURISDICTION_REVIEW" };
  return policy;
}

export function resolveJurisdictionPolicy(
  target: { countryCode: string | null | undefined; regionCode?: string | null },
  workspaceId: string,
  policies: readonly PolicyRow[],
): ResolvedPolicy {
  const country = normalizeCountry(target.countryCode);
  if (!country) {
    return { ...DEFAULT_REVIEW, matchedBy: "unknown_country", reason: "COUNTRY_UNKNOWN" };
  }
  const region = normalizeRegion(target.regionCode);

  const pick = (scope: PolicyRow["scope"], byRegion: boolean) =>
    policies.find(
      (p) =>
        p.scope === scope &&
        (scope === "global" ? p.workspaceId === null : p.workspaceId === workspaceId) &&
        p.countryCode.toUpperCase() === country &&
        (byRegion ? region !== null && p.regionCode?.toUpperCase() === region : p.regionCode === null),
    );

  const order: Array<[PolicyRow | undefined, ResolvedPolicy["matchedBy"]]> = [
    [pick("workspace", true), "workspace_region"],
    [pick("workspace", false), "workspace_country"],
    [pick("global", true), "global_region"],
    [pick("global", false), "global_country"],
  ];

  for (const [row, matchedBy] of order) {
    if (row) {
      return withReason({
        outreachStatus: row.outreachStatus,
        requiresPostalAddress: row.requiresPostalAddress,
        requiresUnsubscribeLink: row.requiresUnsubscribeLink,
        footerTemplate: row.footerTemplate,
        matchedBy,
      });
    }
  }
  return withReason({ ...DEFAULT_REVIEW, matchedBy: "default_review" });
}

/** Only an explicit 'allowed' policy makes a recipient sendable (from a jurisdiction view). */
export function isSendableJurisdiction(policy: ResolvedPolicy): boolean {
  return policy.outreachStatus === "allowed";
}
