/**
 * Deterministic normalization for imported research data (Phase 2 §J–§L).
 * Principle: normalize for matching/search, but never invent or "repair" information. The
 * original cell values are always preserved in prospect_import_rows.raw.
 */

 
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const ZERO_WIDTH = /[​-‍﻿]/g;

/** Trim, remove control/zero-width characters, collapse internal whitespace. Empty → null. */
export function cleanText(value: unknown, maxLength = 2000): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value)
    .replace(CONTROL_CHARS, " ")
    .replace(ZERO_WIDTH, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  return s.length > maxLength ? s.slice(0, maxLength) : s;
}

// ───────────────────────────── Email ─────────────────────────────

export type EmailResult =
  | { ok: true; email: string; normalized: string; domain: string; localPart: string }
  | { ok: false; reason: "EMPTY" | "MULTIPLE_EMAILS" | "INVALID_FORMAT"; original: string | null };

const LOCAL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/;
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Trims, strips a `mailto:` prefix or surrounding angle brackets, lower-cases, and validates basic
 * structure. Questionable addresses are rejected — never corrected.
 */
export function normalizeEmail(value: unknown): EmailResult {
  const original = cleanText(value, 320);
  if (!original) return { ok: false, reason: "EMPTY", original: null };

  let s = original.replace(/^mailto:/i, "").trim();
  if (s.startsWith("<") && s.endsWith(">")) s = s.slice(1, -1).trim();

  if (/[,;\s]/.test(s) && (s.match(/@/g) ?? []).length > 1) {
    return { ok: false, reason: "MULTIPLE_EMAILS", original };
  }
  const at = s.lastIndexOf("@");
  if (s.length > 254 || at < 1 || s.indexOf("@") !== at) {
    return { ok: false, reason: "INVALID_FORMAT", original };
  }
  const localPart = s.slice(0, at);
  const domain = s.slice(at + 1).toLowerCase();
  const labels = domain.split(".");
  const tld = labels[labels.length - 1] ?? "";
  const valid =
    localPart.length <= 64 &&
    LOCAL_RE.test(localPart) &&
    !localPart.startsWith(".") &&
    !localPart.endsWith(".") &&
    !localPart.includes("..") &&
    labels.length >= 2 &&
    labels.every((l) => LABEL_RE.test(l)) &&
    /^[a-z]{2,63}$/.test(tld);
  if (!valid) return { ok: false, reason: "INVALID_FORMAT", original };

  const normalized = `${localPart.toLowerCase()}@${domain}`;
  return { ok: true, email: s, normalized, domain, localPart: localPart.toLowerCase() };
}

// ───────────────────────────── Website / domain ─────────────────────────────

export type WebsiteResult = { website: string | null; domain: string | null; valid: boolean };

/**
 * `company.com`, `www.company.com` and `https://company.com/` all yield domain `company.com`.
 * The original value is kept for display/evidence. Unparseable values keep the original text
 * with no domain.
 */
export function normalizeWebsite(value: unknown): WebsiteResult {
  const website = cleanText(value, 2048);
  if (!website) return { website: null, domain: null, valid: true };
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(website) ? website : `https://${website}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { website, domain: null, valid: false };
    }
    const host = url.hostname
      .toLowerCase()
      .replace(/\.$/, "")
      .replace(/^www\d*\./, "");
    const labels = host.split(".");
    if (labels.length < 2 || !labels.every((l) => LABEL_RE.test(l))) {
      return { website, domain: null, valid: false };
    }
    return { website, domain: host, valid: true };
  } catch {
    return { website, domain: null, valid: false };
  }
}

/** True for absolute http(s) URLs — the only links ever rendered as clickable. */
export function isSafeHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function normalizeEvidenceUrl(value: unknown): { url: string | null; valid: boolean } {
  const url = cleanText(value, 2048);
  if (!url) return { url: null, valid: true };
  return { url, valid: isSafeHttpUrl(url) };
}

// ───────────────────────────── Phone ─────────────────────────────

/**
 * Phone numbers are kept as written (whitespace tidied). Without a reliable country context,
 * converting to E.164 could change meaning, so it is not attempted. Implausible digit counts
 * are flagged, not altered.
 */
export function normalizePhone(value: unknown): { phone: string | null; plausible: boolean } {
  const phone = cleanText(value, 64);
  if (!phone) return { phone: null, plausible: true };
  const digits = phone.replace(/\D/g, "");
  const plausible =
    /^[+0-9()\-.\s/xext]+$/i.test(phone) && digits.length >= 7 && digits.length <= 15;
  return { phone, plausible };
}

// ───────────────────────────── Names ─────────────────────────────

const HONORIFICS = new Set(["dr", "mr", "mrs", "ms", "mx", "miss", "prof", "sir", "dame"]);

/**
 * Derive first/last name from a full contact name only when they were not supplied.
 * "Dr. Jane van der Berg" → first "Jane", last "van der Berg". Single tokens → first name only.
 */
export function splitContactName(full: string | null): {
  firstName: string | null;
  lastName: string | null;
} {
  if (!full) return { firstName: null, lastName: null };
  const tokens = full.split(" ").filter(Boolean);
  while (tokens.length > 1 && HONORIFICS.has(tokens[0]!.replace(/\.$/, "").toLowerCase())) {
    tokens.shift();
  }
  if (tokens.length === 0) return { firstName: null, lastName: null };
  const [first, ...rest] = tokens;
  return { firstName: first ?? null, lastName: rest.length ? rest.join(" ") : null };
}

// ───────────────────────────── Dates ─────────────────────────────

/**
 * Only unambiguous ISO-8601 dates are accepted (YYYY-MM-DD, optionally with time). Formats such
 * as 03/04/2026 are ambiguous (March vs April) and are rejected rather than guessed.
 */
export function parseIsoDate(value: unknown): Date | null {
  const s = cleanText(value, 64);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(s))
    return null;
  const iso = s.length === 10 ? `${s}T00:00:00Z` : s.replace(" ", "T");
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // Reject impossible calendar dates like 2026-02-31 (JS rolls them over).
  const [y, m, day] = s.slice(0, 10).split("-").map(Number);
  if (d.getUTCFullYear() !== y || d.getUTCMonth() + 1 !== m || d.getUTCDate() !== day) {
    if (s.length === 10) return null;
  }
  return d;
}

/** Text for a custom field / free-text column, with a sensible maximum. */
export function normalizeFreeText(value: unknown, max = 2000): string | null {
  return cleanText(value, max);
}
