import { StatusBadge } from "@/components/status-badge";
import type { EligibilityStatus, EmailVerificationStatus } from "@/domain/enums";
import { ELIGIBILITY_LABELS } from "@/domain/eligibility";
import { effectiveVerificationStatus } from "@/domain/verification";

export const VERIFICATION_LABELS: Record<EmailVerificationStatus, string> = {
  VERIFIED: "Verified",
  INVALID: "Invalid",
  RISKY: "Risky",
  UNKNOWN: "Not verified",
  STALE: "Stale",
};

export function EligibilityBadge({ status }: { status: EligibilityStatus | null }) {
  if (!status) return <StatusBadge status="UNKNOWN" label="Not evaluated" />;
  return <StatusBadge status={status} label={ELIGIBILITY_LABELS[status]} />;
}

/** Shows the effective status (VERIFIED/RISKY results older than 90 days display as Stale). */
export function VerificationBadge({
  status,
  verifiedAt,
  now,
}: {
  status: EmailVerificationStatus;
  verifiedAt: Date | null;
  now?: Date;
}) {
  const effective = effectiveVerificationStatus({ status, verifiedAt }, { now });
  return <StatusBadge status={effective} label={VERIFICATION_LABELS[effective]} />;
}
