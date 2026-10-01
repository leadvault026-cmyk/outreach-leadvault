import { cn } from "@/lib/utils";

export type Tone = "success" | "warning" | "danger" | "info" | "neutral";

const TONES: Record<Tone, string> = {
  success: "bg-success-soft text-success border-success/20",
  warning: "bg-warning-soft text-warning border-warning/25",
  danger: "bg-danger-soft text-danger border-danger/20",
  info: "bg-info-soft text-info border-info/20",
  neutral: "bg-muted text-muted-foreground border-border",
};

/** One consistent status → tone mapping app-wide (text + color, never color alone). */
const STATUS_TONES: Record<string, Tone> = {
  // campaigns
  ACTIVE: "success",
  SCHEDULED: "info",
  DRAFT: "neutral",
  PAUSED: "warning",
  COMPLETED: "neutral",
  CANCELLED: "neutral",
  // mailboxes
  CONNECTED: "success",
  NEEDS_ATTENTION: "warning",
  DISCONNECTED: "danger",
  // eligibility / verification
  ELIGIBLE: "success",
  NEEDS_REVIEW: "warning",
  INELIGIBLE: "danger",
  SUPPRESSED: "danger",
  VERIFIED: "success",
  RISKY: "warning",
  INVALID: "danger",
  UNKNOWN: "neutral",
  STALE: "warning",
  // reply classification
  UNREVIEWED: "info",
  INTERESTED: "success",
  NOT_INTERESTED: "neutral",
  FOLLOW_UP: "info",
  OUT_OF_OFFICE: "neutral",
  UNSUBSCRIBE: "danger",
  OTHER: "neutral",
  // jurisdiction
  allowed: "success",
  review: "warning",
  blocked: "danger",
  // warm-up
  warming: "info",
  ready: "success",
  paused: "warning",
};

export function humanizeStatus(status: string): string {
  const s = status.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function StatusBadge({
  status,
  label,
  tone,
  className,
}: {
  status: string;
  label?: string;
  tone?: Tone;
  className?: string;
}) {
  const t = tone ?? STATUS_TONES[status] ?? "neutral";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONES[t],
        className,
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current opacity-80" />
      {label ?? humanizeStatus(status)}
    </span>
  );
}

export function DemoBadge() {
  return (
    <StatusBadge status="demo" tone="info" label="Demo data" className="uppercase tracking-wide" />
  );
}
