import type { Tone } from "@/components/status-badge";

export const IMPORT_STATUS: Record<string, { label: string; tone: Tone }> = {
  uploaded: { label: "Needs mapping", tone: "info" },
  parsed: { label: "Needs mapping", tone: "info" },
  mapped: { label: "Needs settings", tone: "info" },
  validating: { label: "Validating", tone: "info" },
  ready: { label: "Ready to import", tone: "warning" },
  importing: { label: "Importing", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  completed_with_issues: { label: "Completed with issues", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export const CATEGORY_LABELS: Record<string, { label: string; tone: Tone; description: string }> = {
  ready: { label: "Ready", tone: "success", description: "Imported and eligible for outreach." },
  review: {
    label: "Review required",
    tone: "warning",
    description: "Imported, but a person must review before outreach.",
  },
  ineligible: {
    label: "Ineligible",
    tone: "danger",
    description: "Imported, but cannot be contacted as the record stands.",
  },
  suppressed: {
    label: "Suppressed",
    tone: "danger",
    description: "Imported, but on a do-not-contact list.",
  },
  duplicate: {
    label: "Duplicate",
    tone: "neutral",
    description: "Repeats another row or an existing prospect; not imported again.",
  },
  invalid: {
    label: "Invalid",
    tone: "danger",
    description: "Rejected — the row has errors that must be fixed in the source.",
  },
  skipped: {
    label: "Skipped",
    tone: "neutral",
    description: "Blank row, or the import was cancelled.",
  },
  error: { label: "Error", tone: "danger", description: "Could not be saved; see the reason." },
};

export const ACTION_LABELS: Record<string, string> = {
  create: "New prospect",
  update: "Updates existing",
  unchanged: "Already up to date",
  duplicate_in_file: "Duplicate in file",
  duplicate_existing: "Already exists (skipped)",
  invalid: "Not imported",
  skipped: "Not imported",
  error: "Not saved",
  pending: "Pending",
};

export const RESULT_ACTION_LABELS: Record<string, string> = {
  create: "Imported (new)",
  update: "Updated",
  unchanged: "Unchanged",
  duplicate_in_file: "Skipped — duplicate in file",
  duplicate_existing: "Skipped — already exists",
  invalid: "Rejected",
  skipped: "Skipped",
  error: "Error",
  pending: "Not processed",
};
