import { classifyEmailDomain, isRoleAddress, type EmailDomainClass } from "./email-domain";
import type { EligibilityStatus, EmailVerificationStatus } from "./enums";
import { resolveJurisdictionPolicy, type PolicyRow, type ResolvedPolicy } from "./jurisdiction";
import { DEFAULT_VERIFICATION_MAX_AGE_DAYS, effectiveVerificationStatus } from "./verification";

/**
 * THE outreach-eligibility engine (architecture §10; Phase 2 §R). Pure and deterministic: every
 * caller — import preview, import commit, prospect detail, cache refresh, audiences, and later the
 * campaign dispatcher — uses this one function. UI components never re-implement rules.
 *
 * Decision precedence: SUPPRESSED > INELIGIBLE > NEEDS_REVIEW ("review required") > ELIGIBLE.
 * All applicable reasons are returned (not only the first), so operators see the full picture.
 */

export const REASONS = {
  // Suppressed — do not contact.
  GLOBAL_SUPPRESSION: {
    severity: "suppressed",
    label: "LeadVault-wide suppression",
    explanation: "This address or domain is on the LeadVault-wide do-not-contact list.",
  },
  WORKSPACE_SUPPRESSION: {
    severity: "suppressed",
    label: "Workspace suppression",
    explanation: "This address or domain is on this workspace's do-not-contact list.",
  },
  UNSUBSCRIBED: {
    severity: "suppressed",
    label: "Unsubscribed",
    explanation: "The recipient asked not to be contacted.",
  },
  // Ineligible — cannot be contacted as the record stands.
  MISSING_EMAIL: {
    severity: "ineligible",
    label: "No email address",
    explanation: "The record has no email address.",
  },
  INVALID_EMAIL: {
    severity: "ineligible",
    label: "Invalid email address",
    explanation: "The email address is not a valid address.",
  },
  EMAIL_VERIFICATION_FAILED: {
    severity: "ineligible",
    label: "Email failed verification",
    explanation: "Verification reported the address as undeliverable.",
  },
  CONSUMER_EMAIL_NOT_ALLOWED: {
    severity: "ineligible",
    label: "Personal email address",
    explanation:
      "Outreach is business-to-business only; personal mailbox providers (e.g. Gmail) are not contacted.",
  },
  JURISDICTION_BLOCKED: {
    severity: "ineligible",
    label: "Jurisdiction blocked",
    explanation: "The compliance policy for this location does not allow outreach.",
  },
  MISSING_REQUIRED_DATA: {
    severity: "ineligible",
    label: "Missing required data",
    explanation: "The record is missing a company name.",
  },
  // Review required — a person must confirm before outreach.
  EMAIL_NOT_VERIFIED: {
    severity: "review",
    label: "Email not verified",
    explanation: "There is no verification result for this address.",
  },
  EMAIL_RISKY: {
    severity: "review",
    label: "Email risky",
    explanation: "Verification could not confirm the mailbox (for example a catch-all domain).",
  },
  VERIFICATION_STALE: {
    severity: "review",
    label: "Verification out of date",
    explanation: `The verification result is older than ${DEFAULT_VERIFICATION_MAX_AGE_DAYS} days.`,
  },
  EMAIL_DOMAIN_UNKNOWN: {
    severity: "review",
    label: "Business domain not confirmed",
    explanation:
      "The email domain does not match the company website, so it is not confirmed as a business address.",
  },
  ROLE_BASED_EMAIL: {
    severity: "review",
    label: "Shared mailbox",
    explanation: "The address is a shared mailbox (such as info@) rather than a named person.",
  },
  MISSING_CONTACT_NAME: {
    severity: "review",
    label: "No contact name",
    explanation: "Person-to-person outreach needs a named contact.",
  },
  COUNTRY_UNKNOWN: {
    severity: "review",
    label: "Country unknown",
    explanation:
      "The prospect's country is missing or not recognized, so no compliance policy can apply.",
  },
  JURISDICTION_REVIEW: {
    severity: "review",
    label: "Jurisdiction not approved",
    explanation:
      "No compliance policy approves outreach to this location yet. Unconfigured locations are held for review.",
  },
} as const satisfies Record<
  string,
  { severity: "suppressed" | "ineligible" | "review"; label: string; explanation: string }
>;

export type ReasonCode = keyof typeof REASONS;
const ORDER = Object.keys(REASONS) as ReasonCode[];

export type SuppressionMatch = {
  scope: "global" | "workspace";
  reason: string;
  valueType: "email" | "domain";
};

export type EligibilityInput = {
  workspaceId: string;
  companyName: string | null;
  contactName: string | null;
  /** The address as stored (may be non-null even when it failed validation). */
  email: string | null;
  emailNormalized: string | null;
  emailDomain: string | null;
  websiteDomain: string | null;
  verificationStatus: EmailVerificationStatus;
  verifiedAt: Date | null;
  countryCode: string | null;
  regionCode: string | null;
  /** Active suppressions that match this address or its domain (workspace or global). */
  suppressions: readonly SuppressionMatch[];
  /** An unsubscribe for this address in this workspace whose suppression is still active. */
  unsubscribed: boolean;
  policies: readonly PolicyRow[];
};

export type EligibilityOptions = {
  now?: Date;
  /** B2B-only infrastructure (architecture §14.7.5). */
  requireBusinessEmail?: boolean;
  verificationMaxAgeDays?: number;
};

export type EligibilityResult = {
  status: EligibilityStatus;
  reasons: ReasonCode[];
  domainClass: EmailDomainClass;
  verification: EmailVerificationStatus;
  jurisdiction: ResolvedPolicy;
  /** When the decision could change with time alone (verification ageing). */
  expiresAt: Date | null;
};

export function evaluateEligibility(
  input: EligibilityInput,
  options: EligibilityOptions = {},
): EligibilityResult {
  const now = options.now ?? new Date();
  const maxAgeDays = options.verificationMaxAgeDays ?? DEFAULT_VERIFICATION_MAX_AGE_DAYS;
  const requireBusiness = options.requireBusinessEmail ?? true;
  const reasons = new Set<ReasonCode>();

  // Suppression & unsubscribe (checked whatever else is wrong with the record).
  for (const s of input.suppressions) {
    reasons.add(s.scope === "global" ? "GLOBAL_SUPPRESSION" : "WORKSPACE_SUPPRESSION");
    if (s.reason === "UNSUBSCRIBE") reasons.add("UNSUBSCRIBED");
  }
  if (input.unsubscribed) reasons.add("UNSUBSCRIBED");

  // Required business data.
  if (!input.companyName?.trim()) reasons.add("MISSING_REQUIRED_DATA");
  if (!input.contactName?.trim()) reasons.add("MISSING_CONTACT_NAME");

  // Email presence, validity, verification, domain class.
  const domainClass = classifyEmailDomain(input.emailDomain, input.websiteDomain);
  const verification = effectiveVerificationStatus(
    { status: input.verificationStatus, verifiedAt: input.verifiedAt },
    { now, maxAgeDays },
  );
  if (!input.email?.trim() && !input.emailNormalized) {
    reasons.add("MISSING_EMAIL");
  } else if (!input.emailNormalized) {
    reasons.add("INVALID_EMAIL");
  } else {
    if (verification === "INVALID") reasons.add("EMAIL_VERIFICATION_FAILED");
    else if (verification === "RISKY") reasons.add("EMAIL_RISKY");
    else if (verification === "STALE") reasons.add("VERIFICATION_STALE");
    else if (verification === "UNKNOWN") reasons.add("EMAIL_NOT_VERIFIED");

    if (domainClass === "CONSUMER" && requireBusiness) reasons.add("CONSUMER_EMAIL_NOT_ALLOWED");
    else if (domainClass === "UNKNOWN") reasons.add("EMAIL_DOMAIN_UNKNOWN");

    const local = input.emailNormalized.split("@")[0];
    if (isRoleAddress(local)) reasons.add("ROLE_BASED_EMAIL");
  }

  // Jurisdiction (fail closed; never approved by the data itself).
  const jurisdiction = resolveJurisdictionPolicy(
    { countryCode: input.countryCode, regionCode: input.regionCode },
    input.workspaceId,
    input.policies,
  );
  if (jurisdiction.reason) reasons.add(jurisdiction.reason);

  const sorted = ORDER.filter((c) => reasons.has(c));
  const severities = new Set(sorted.map((c) => REASONS[c].severity));
  const status: EligibilityStatus = severities.has("suppressed")
    ? "SUPPRESSED"
    : severities.has("ineligible")
      ? "INELIGIBLE"
      : severities.has("review")
        ? "NEEDS_REVIEW"
        : "ELIGIBLE";

  // A VERIFIED/RISKY result turns STALE at verifiedAt + maxAge; the cached decision expires then.
  const expiresAt =
    input.verifiedAt && (verification === "VERIFIED" || verification === "RISKY")
      ? new Date(input.verifiedAt.getTime() + maxAgeDays * 86_400_000)
      : null;

  return { status, reasons: sorted, domainClass, verification, jurisdiction, expiresAt };
}

export const ELIGIBILITY_LABELS: Record<EligibilityStatus, string> = {
  ELIGIBLE: "Eligible",
  NEEDS_REVIEW: "Review required",
  INELIGIBLE: "Ineligible",
  SUPPRESSED: "Suppressed",
};

export function reasonLabel(code: string): string {
  return (REASONS as Record<string, { label: string }>)[code]?.label ?? code;
}

export function reasonExplanation(code: string): string {
  return (REASONS as Record<string, { explanation: string }>)[code]?.explanation ?? code;
}
