import { STOP_REASON_LABELS } from "@/domain/campaigns";
import { reasonLabel } from "@/domain/eligibility";
import { SUPPRESSION_REASON_LABELS } from "@/domain/suppression";

/** Plain-language text for engine stop/exclusion codes such as "NOT_ELIGIBLE:A,B". */
export function reasonText(code: string | null | undefined): string {
  if (!code) return "";
  const [head, tail] = code.split(/:(.*)/s) as [string, string | undefined];
  if (head === "MISSING_REQUIRED_VARIABLE")
    return tail
      ? `No value for {{${tail.split(",").join("}}, {{")}}}`
      : "A personalization field is empty";
  if (head === "NOT_ELIGIBLE")
    return `No longer eligible at send time${tail ? `: ${tail.split(",").filter(Boolean).map(reasonLabel).join(", ")}` : ""}`;
  if (head === "SUPPRESSED")
    return `Suppressed${tail ? ` (${SUPPRESSION_REASON_LABELS[tail]?.toLowerCase() ?? tail})` : ""}`;
  if (head === "SEND_FAILED") return `The provider rejected the message${tail ? ` (${tail})` : ""}`;
  return STOP_REASON_LABELS[head] ?? reasonLabel(code);
}
