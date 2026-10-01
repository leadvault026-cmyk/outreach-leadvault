import { countryName } from "./geo";

/**
 * Personalization (architecture §11). Plain-text substitution only: no code execution, no HTML.
 *
 *   {{first_name}}          value, or the recipient is held back (never "Hi undefined")
 *   {{first_name|there}}    value, or the fallback text
 *
 * Unknown tokens and malformed braces are validation errors when a template or step is saved.
 */
export const TOKENS = {
  first_name: "Contact first name",
  last_name: "Contact last name",
  contact_name: "Contact full name",
  contact_title: "Contact job title",
  company_name: "Company name",
  provider_type: "Provider type / business type",
  city: "City",
  state: "State / region",
  country: "Country name",
  website: "Company website domain",
  sender_name: "Sender's name (from the mailbox)",
} as const;
export type TokenName = keyof typeof TOKENS;

export const TOKEN_NAMES = Object.keys(TOKENS) as TokenName[];

const TOKEN_RE = /\{\{\s*([^{}|]*?)\s*(?:\|([^{}]*))?\}\}/g;

export type TemplateIssue = { code: "UNKNOWN_TOKEN" | "MALFORMED_TOKEN"; message: string };

export type ParsedToken = { raw: string; name: string; fallback: string | null };

export function parseTokens(text: string): ParsedToken[] {
  const out: ParsedToken[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    out.push({
      raw: m[0],
      name: (m[1] ?? "").trim(),
      fallback: m[2] === undefined ? null : m[2].trim(),
    });
  }
  return out;
}

/** Validate a subject/body. Returns every problem (empty list = valid). */
export function validateTemplateText(text: string): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  const tokens = parseTokens(text);
  for (const t of tokens) {
    if (!(t.name in TOKENS)) {
      issues.push(
        t.name
          ? { code: "UNKNOWN_TOKEN", message: `Unknown personalization field {{${t.name}}}.` }
          : { code: "MALFORMED_TOKEN", message: `“${t.raw}” has no field name.` },
      );
    }
  }
  // Leftover braces after removing well-formed tokens are malformed ("{{name}", "{first_name}}").
  const rest = text.replace(TOKEN_RE, "");
  if (/\{\{|\}\}/.test(rest)) {
    issues.push({
      code: "MALFORMED_TOKEN",
      message:
        "A personalization field is not closed correctly. Use {{field}} or {{field|fallback}}.",
    });
  }
  return issues;
}

export function tokensUsed(...texts: string[]): TokenName[] {
  const set = new Set<TokenName>();
  for (const text of texts)
    for (const t of parseTokens(text)) if (t.name in TOKENS) set.add(t.name as TokenName);
  return [...set];
}

export type TokenValues = Partial<Record<TokenName, string | null | undefined>>;

export type RenderResult = {
  text: string;
  /** Tokens with no value and no fallback. The message must not be sent. */
  missing: TokenName[];
};

export function renderTemplate(text: string, values: TokenValues): RenderResult {
  const missing = new Set<TokenName>();
  const rendered = text.replace(TOKEN_RE, (raw, nameRaw: string, fallbackRaw?: string) => {
    const name = nameRaw.trim() as TokenName;
    if (!(name in TOKENS)) return raw; // validated at save time; never silently dropped
    const value = values[name]?.trim();
    if (value) return value;
    const fallback = fallbackRaw?.trim();
    if (fallbackRaw !== undefined) return fallback ?? "";
    missing.add(name);
    return "";
  });
  return { text: rendered, missing: [...missing] };
}

/** Token values for one prospect and sender. Only existing, normalized fields are used. */
export function prospectTokenValues(
  p: {
    firstName: string | null;
    lastName: string | null;
    contactName: string | null;
    contactTitle: string | null;
    companyName: string;
    businessType: string | null;
    city: string | null;
    state: string | null;
    countryCode: string | null;
    websiteDomain: string | null;
  },
  sender: { name: string | null },
): TokenValues {
  return {
    first_name: p.firstName,
    last_name: p.lastName,
    contact_name: p.contactName,
    contact_title: p.contactTitle,
    company_name: p.companyName,
    provider_type: p.businessType,
    city: p.city,
    state: p.state,
    country: p.countryCode ? (countryName(p.countryCode) ?? p.countryCode) : null,
    website: p.websiteDomain,
    sender_name: sender.name,
  };
}

export const TOKEN_LABEL = (name: string) =>
  (TOKENS as Record<string, string>)[name] ?? name.replace(/_/g, " ");
