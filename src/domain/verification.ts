import type { EmailVerificationStatus } from "./enums";

/**
 * Email verification foundation (architecture §14.7.5; Phase 1 brief §23).
 * LeadVault Outreach accepts trusted verification results imported from the LeadVault research
 * system and, later, from a re-verification provider (vendor not chosen). Both are normalized
 * into one model: VERIFIED | INVALID | RISKY | UNKNOWN | STALE.
 */

/** Results older than this are treated as STALE (owner-configurable later). */
export const DEFAULT_VERIFICATION_MAX_AGE_DAYS = 90;

export type VerificationRecord = {
  status: EmailVerificationStatus;
  verifiedAt: Date | null;
  source: string | null;
  /** Raw label from the source (kept for traceability). */
  detail: string | null;
};

const LABELS: Record<string, Exclude<EmailVerificationStatus, "STALE">> = {
  // Verified / deliverable
  verified: "VERIFIED",
  valid: "VERIFIED",
  deliverable: "VERIFIED",
  ok: "VERIFIED",
  safe: "VERIFIED",
  // Invalid / undeliverable
  invalid: "INVALID",
  undeliverable: "INVALID",
  bounce: "INVALID",
  bounced: "INVALID",
  "does-not-exist": "INVALID",
  disposable: "INVALID",
  "syntax-error": "INVALID",
  // Risky / uncertain deliverability
  risky: "RISKY",
  "catch-all": "RISKY",
  "accept-all": "RISKY",
  role: "RISKY",
  "role-based": "RISKY",
  "spam-trap": "RISKY",
  "do-not-mail": "RISKY",
  // Unknown
  unknown: "UNKNOWN",
  unverified: "UNKNOWN",
  "": "UNKNOWN",
};

function canonicalLabel(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
}

/**
 * Normalize a raw verification label (e.g. from a research CSV column) into a status.
 * Unrecognized labels are UNKNOWN — never optimistically VERIFIED.
 */
export function normalizeVerificationLabel(
  raw: string | null | undefined,
): Exclude<EmailVerificationStatus, "STALE"> {
  if (raw == null) return "UNKNOWN";
  return LABELS[canonicalLabel(raw)] ?? "UNKNOWN";
}

/**
 * Build a stored verification record from imported/provider data. A positive or negative
 * result without a verification date cannot be trusted for freshness, so it is downgraded to
 * UNKNOWN (keeping the raw label as detail). Future dates are rejected the same way.
 */
export function buildVerificationRecord(input: {
  label: string | null | undefined;
  verifiedAt: Date | null | undefined;
  source: string;
  now?: Date;
}): VerificationRecord {
  const now = input.now ?? new Date();
  const status = normalizeVerificationLabel(input.label);
  const detail = input.label?.trim() ? input.label.trim() : null;
  const dateIsUsable =
    input.verifiedAt instanceof Date &&
    !Number.isNaN(input.verifiedAt.getTime()) &&
    input.verifiedAt.getTime() <= now.getTime();

  if (status === "UNKNOWN" || !dateIsUsable) {
    return { status: "UNKNOWN", verifiedAt: null, source: null, detail };
  }
  return { status, verifiedAt: input.verifiedAt!, source: input.source, detail };
}

/** Effective status at a point in time: VERIFIED/RISKY results age into STALE. */
export function effectiveVerificationStatus(
  record: Pick<VerificationRecord, "status" | "verifiedAt">,
  options: { now?: Date; maxAgeDays?: number } = {},
): EmailVerificationStatus {
  const now = options.now ?? new Date();
  const maxAgeDays = options.maxAgeDays ?? DEFAULT_VERIFICATION_MAX_AGE_DAYS;
  if (record.status === "INVALID" || record.status === "UNKNOWN" || record.status === "STALE") {
    return record.status; // INVALID stays INVALID regardless of age.
  }
  if (!record.verifiedAt) return "UNKNOWN";
  const ageDays = (now.getTime() - record.verifiedAt.getTime()) / 86_400_000;
  return ageDays > maxAgeDays ? "STALE" : record.status;
}

/**
 * Contract for a future re-verification provider. No vendor is selected (owner decision §30-2a);
 * implementations must map vendor results through normalizeVerificationLabel().
 */
export interface EmailVerificationProvider {
  readonly name: string;
  verify(
    emails: readonly string[],
  ): Promise<
    Array<{ email: string; label: string; checkedAt: Date } | { email: string; error: string }>
  >;
}
