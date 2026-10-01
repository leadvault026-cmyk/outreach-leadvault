/** Matches the StatusBadge tones. */
type Tone = "success" | "warning" | "danger" | "info" | "neutral";

/**
 * Campaign and recipient rules (architecture §9–§10). Pure; the server enforces them with
 * state-guarded conditional updates, so a transition the UI did not expect is simply a no-op.
 */
export const CAMPAIGN_STATUS_LABELS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  SCHEDULED: { label: "Scheduled", tone: "info" },
  ACTIVE: { label: "Running", tone: "success" },
  PAUSED: { label: "Paused", tone: "warning" },
  COMPLETED: { label: "Completed", tone: "neutral" },
  CANCELLED: { label: "Stopped", tone: "danger" },
};

export type CampaignAction = "launch" | "pause" | "resume" | "stop";

/** Allowed source states per operator action. The target is decided by the server. */
export const CAMPAIGN_TRANSITIONS: Record<CampaignAction, readonly string[]> = {
  launch: ["DRAFT"],
  pause: ["SCHEDULED", "ACTIVE"],
  resume: ["PAUSED"],
  stop: ["SCHEDULED", "ACTIVE", "PAUSED"],
};

export function canTransition(status: string, action: CampaignAction): boolean {
  return CAMPAIGN_TRANSITIONS[action].includes(status);
}

/** Recipient states that still expect messages. Everything else is terminal. */
export const LIVE_RECIPIENT_STATUSES = ["QUEUED", "SCHEDULED", "SENDING"] as const;

export const RECIPIENT_STATUS_LABELS: Record<string, { label: string; tone: Tone }> = {
  QUEUED: { label: "Queued", tone: "info" },
  SCHEDULED: { label: "Waiting for next step", tone: "info" },
  SENDING: { label: "Sending", tone: "info" },
  COMPLETED: { label: "Sequence finished", tone: "neutral" },
  REPLIED: { label: "Replied", tone: "success" },
  BOUNCED: { label: "Bounced", tone: "danger" },
  UNSUBSCRIBED: { label: "Unsubscribed", tone: "danger" },
  SUPPRESSED: { label: "Suppressed", tone: "danger" },
  STOPPED: { label: "Stopped", tone: "warning" },
  FAILED: { label: "Failed", tone: "danger" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  EXCLUDED: { label: "Excluded", tone: "neutral" },
};

export const MESSAGE_STATUS_LABELS: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: "Queued to send", tone: "info" },
  SENDING: { label: "Sending", tone: "info" },
  RETRY_WAIT: { label: "Retry scheduled", tone: "warning" },
  RECONCILIATION_REQUIRED: { label: "Checking whether sent", tone: "warning" },
  OPERATOR_REVIEW: { label: "Needs review", tone: "danger" },
  SENT: { label: "Sent", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
  CANCELLED: { label: "Not sent", tone: "neutral" },
};

/** Human labels for stop/exclusion reasons written by the engine. */
export const STOP_REASON_LABELS: Record<string, string> = {
  REPLIED: "The prospect replied",
  HARD_BOUNCE: "The address hard-bounced",
  UNSUBSCRIBED: "The prospect unsubscribed",
  SUPPRESSED: "The address or domain is suppressed",
  NOT_ELIGIBLE: "No longer eligible at send time",
  MISSING_REQUIRED_VARIABLE: "A personalization field has no value",
  ALREADY_IN_ACTIVE_CAMPAIGN: "Already in another running campaign",
  CAMPAIGN_STOPPED: "The campaign was stopped",
  OPERATOR_STOPPED: "Stopped by an operator",
  SEND_FAILED: "The provider rejected the message",
  NO_EMAIL: "No email address",
};

// ───────────────────────────── Time zones and sending windows ─────────────────────────────

export const WEEKDAYS = [
  { n: 1, short: "Mon" },
  { n: 2, short: "Tue" },
  { n: 3, short: "Wed" },
  { n: 4, short: "Thu" },
  { n: 5, short: "Fri" },
  { n: 6, short: "Sat" },
  { n: 7, short: "Sun" },
] as const;

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock parts of an instant in a time zone (ISO weekday: Monday = 1 … Sunday = 7). */
export function zonedParts(instant: Date, tz: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday!) + 1;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday,
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

/** Converts a wall-clock date and time in `tz` to the UTC instant (DST-aware). */
export function zonedTimeToUtc(date: string, time: string, tz: string): Date {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const [h, mi] = time.split(":").map(Number) as [number, number];
  const wanted = Date.UTC(y, mo - 1, d, h, mi);
  let guess = wanted;
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(new Date(guess), tz);
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    const diff = wanted - shown;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

export type SendWindow = {
  days: readonly number[] | null;
  start: string | null; // "HH:MM" or "HH:MM:SS"
  end: string | null;
};

const minutesOf = (t: string) => {
  const [h, m] = t.split(":").map(Number) as [number, number];
  return h * 60 + m;
};

/** Whether `instant` falls inside the window in `tz`. A null window part means "no limit". */
export function isWithinWindow(instant: Date, window: SendWindow, tz: string): boolean {
  const p = zonedParts(instant, tz);
  if (window.days && window.days.length && !window.days.includes(p.weekday)) return false;
  if (window.start && window.end) {
    const now = p.hour * 60 + p.minute;
    if (now < minutesOf(window.start) || now >= minutesOf(window.end)) return false;
  }
  return true;
}

export const DELAY_UNITS = { minutes: 1, hours: 60, days: 1440 } as const;
export type DelayUnit = keyof typeof DELAY_UNITS;

export function splitDelay(minutes: number): { value: number; unit: DelayUnit } {
  if (minutes > 0 && minutes % 1440 === 0) return { value: minutes / 1440, unit: "days" };
  if (minutes > 0 && minutes % 60 === 0) return { value: minutes / 60, unit: "hours" };
  return { value: minutes, unit: "minutes" };
}

export function formatDelay(minutes: number): string {
  const { value, unit } = splitDelay(minutes);
  const label = value === 1 ? unit.slice(0, -1) : unit;
  return `${value} ${label}`;
}

/** Follow-ups in thread mode reuse the first subject with a single "Re:" prefix. */
export function replySubject(firstSubject: string): string {
  return /^re:/i.test(firstSubject.trim()) ? firstSubject.trim() : `Re: ${firstSubject.trim()}`;
}
