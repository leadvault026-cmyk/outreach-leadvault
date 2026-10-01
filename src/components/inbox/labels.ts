/** Inbox classification labels and tones (shared by list and thread views). */
type Tone = "success" | "warning" | "danger" | "info" | "neutral";

export const CLASSIFICATION_LABELS: Record<string, { label: string; tone: Tone }> = {
  UNREVIEWED: { label: "To review", tone: "info" },
  INTERESTED: { label: "Interested", tone: "success" },
  FOLLOW_UP: { label: "Follow up later", tone: "info" },
  NOT_INTERESTED: { label: "Not interested", tone: "neutral" },
  OUT_OF_OFFICE: { label: "Out of office", tone: "neutral" },
  UNSUBSCRIBE: { label: "Unsubscribe", tone: "danger" },
  OTHER: { label: "Other", tone: "neutral" },
};

export const REPLY_KIND_LABELS: Record<string, string> = {
  human_reply: "Reply",
  auto_reply: "Automatic reply",
  unsubscribe_request: "Opt-out request",
  bounce_report: "Bounce report",
  other: "Other",
};
