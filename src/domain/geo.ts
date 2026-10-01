/**
 * Country and region normalization. Countries resolve to ISO 3166-1 alpha-2 using the platform's
 * Unicode CLDR data (Intl.DisplayNames) — no hand-maintained country list, no default country.
 * Regions resolve to ISO 3166-2 only where an unambiguous table exists (US, CA); elsewhere the
 * researched state/region text is kept and region_code stays null.
 */

const displayNames = new Intl.DisplayNames(["en"], { type: "region" });

function key(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Codes that are not countries or are reserved/exceptional.
const EXCLUDED = new Set(["EU", "EZ", "UN", "QO", "XA", "XB", "ZZ", "AA", "UK"]);

const BY_NAME = new Map<string, string>();
const VALID_CODES = new Set<string>();
for (let a = 65; a <= 90; a++) {
  for (let b = 65; b <= 90; b++) {
    const code = String.fromCharCode(a, b);
    if (EXCLUDED.has(code)) continue;
    // Skip withdrawn/alias codes (DD→DE, UK→GB, YU→RS…): only canonical ISO codes are stored.
    let canonical: string | undefined;
    try {
      canonical = Intl.getCanonicalLocales(`und-${code}`)[0];
    } catch {
      canonical = undefined;
    }
    if (canonical !== `und-${code}`) continue;
    let name: string | undefined;
    try {
      name = displayNames.of(code);
    } catch {
      name = undefined;
    }
    if (name && name !== code && !/unknown/i.test(name)) {
      VALID_CODES.add(code);
      if (!BY_NAME.has(key(name))) BY_NAME.set(key(name), code);
    }
  }
}

/** Common unambiguous aliases not produced by CLDR display names. */
const ALIASES: Record<string, string> = {
  usa: "US",
  "u s": "US",
  "u s a": "US",
  "united states of america": "US",
  "the united states": "US",
  uk: "GB",
  "u k": "GB",
  "great britain": "GB",
  "united kingdom of great britain and northern ireland": "GB",
  "republic of ireland": "IE",
  uae: "AE",
  "south korea": "KR",
  "republic of korea": "KR",
  russia: "RU",
  "czech republic": "CZ",
  holland: "NL",
  "ivory coast": "CI",
};

export type CountryResult = { code: string | null; recognized: boolean; original: string | null };

export function normalizeCountry(value: unknown): CountryResult {
  const original = value == null ? null : String(value).trim() || null;
  if (!original) return { code: null, recognized: true, original: null };
  const upper = original.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) {
    // "UK" is not ISO but is universally meant as GB.
    if (upper === "UK") return { code: "GB", recognized: true, original };
    return VALID_CODES.has(upper)
      ? { code: upper, recognized: true, original }
      : { code: null, recognized: false, original };
  }
  const k = key(original);
  const code = ALIASES[k] ?? BY_NAME.get(k) ?? null;
  return { code, recognized: code !== null, original };
}

export function isValidCountryCode(code: string): boolean {
  return VALID_CODES.has(code.toUpperCase());
}

export function countryName(code: string | null | undefined): string | null {
  if (!code) return null;
  try {
    return displayNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/** All recognized countries sorted by English name, for selects. */
export function countryOptions(): Array<{ code: string; name: string }> {
  return [...VALID_CODES]
    .map((code) => ({ code, name: countryName(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const US_REGIONS: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  DC: "District of Columbia",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  PR: "Puerto Rico",
  GU: "Guam",
  VI: "U.S. Virgin Islands",
  AS: "American Samoa",
  MP: "Northern Mariana Islands",
};
const CA_REGIONS: Record<string, string> = {
  AB: "Alberta",
  BC: "British Columbia",
  MB: "Manitoba",
  NB: "New Brunswick",
  NL: "Newfoundland and Labrador",
  NS: "Nova Scotia",
  NT: "Northwest Territories",
  NU: "Nunavut",
  ON: "Ontario",
  PE: "Prince Edward Island",
  QC: "Quebec",
  SK: "Saskatchewan",
  YT: "Yukon",
};
const REGION_TABLES: Record<string, Record<string, string>> = { US: US_REGIONS, CA: CA_REGIONS };

/**
 * ISO 3166-2 code for a researched state/region, when the country has a table and the value is
 * an exact code or name (e.g. "TX", "Texas" → "US-TX"). Otherwise null — never guessed.
 */
export function normalizeRegion(state: string | null, countryCode: string | null): string | null {
  if (!state || !countryCode) return null;
  const table = REGION_TABLES[countryCode];
  if (!table) return null;
  const upper = state
    .trim()
    .toUpperCase()
    .replace(/^[A-Z]{2}-/, "");
  if (table[upper]) return `${countryCode}-${upper}`;
  const k = key(state);
  const hit = Object.entries(table).find(([, name]) => key(name) === k);
  return hit ? `${countryCode}-${hit[0]}` : null;
}

export function regionName(regionCode: string | null | undefined): string | null {
  if (!regionCode) return null;
  const [country, sub] = regionCode.split("-");
  return (country && sub && REGION_TABLES[country]?.[sub]) || regionCode;
}
