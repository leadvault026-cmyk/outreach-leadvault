import { z } from "zod";
import { normalizeEmail } from "./prospects/normalize";

/**
 * Suppression rules (architecture §18). Suppression means DO NOT CONTACT — it never deletes data.
 * Records are never hard-deleted: "remove" is a lift with a mandatory reason.
 */

/** Reasons an operator can choose for a manual suppression. */
export const MANUAL_SUPPRESSION_REASONS = [
  "MANUAL_DO_NOT_CONTACT",
  "COMPLIANCE",
  "UNSUBSCRIBE",
] as const;

export const SUPPRESSION_REASON_LABELS: Record<string, string> = {
  UNSUBSCRIBE: "Unsubscribed",
  HARD_BOUNCE: "Hard bounce",
  MANUAL_DO_NOT_CONTACT: "Do not contact",
  COMPLIANCE: "Compliance",
  COMPLAINT: "Complaint",
};

export const SUPPRESSION_SOURCE_LABELS: Record<string, string> = {
  unsubscribe_link: "Unsubscribe link",
  reply: "Reply",
  bounce: "Bounce",
  manual: "Added manually",
  import: "Import",
  system: "System",
};

const DOMAIN_RE =
  /^(?=.{3,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export function normalizeSuppressionValue(
  valueType: "email" | "domain",
  raw: string,
): { ok: true; value: string } | { ok: false; message: string } {
  if (valueType === "email") {
    const e = normalizeEmail(raw);
    return e.ok
      ? { ok: true, value: e.normalized }
      : { ok: false, message: "Enter a valid email address." };
  }
  const d = raw
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/^[a-z]+:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "");
  return DOMAIN_RE.test(d) && /\.[a-z]{2,63}$/.test(d)
    ? { ok: true, value: d }
    : { ok: false, message: "Enter a domain such as example.com." };
}

export const addSuppressionSchema = z.object({
  valueType: z.enum(["email", "domain"]),
  value: z.string().trim().min(3).max(320),
  scope: z.enum(["workspace", "global"]),
  reason: z.enum(MANUAL_SUPPRESSION_REASONS),
  note: z.string().trim().min(5, "Explain why (at least 5 characters).").max(500),
});

export const liftSuppressionSchema = z.object({
  suppressionId: z.uuid(),
  reason: z.string().trim().min(10, "Give a reason of at least 10 characters.").max(500),
});
