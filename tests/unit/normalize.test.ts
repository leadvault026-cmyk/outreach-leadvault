import { describe, expect, it } from "vitest";
import { classifyEmailDomain, isRoleAddress } from "@/domain/email-domain";
import { countryName, normalizeCountry, normalizeRegion } from "@/domain/geo";
import {
  cleanText,
  isSafeHttpUrl,
  normalizeEmail,
  normalizeEvidenceUrl,
  normalizePhone,
  normalizeWebsite,
  parseIsoDate,
  splitContactName,
} from "@/domain/prospects/normalize";
import { normalizeSuppressionValue } from "@/domain/suppression";

describe("cleanText", () => {
  it("trims, collapses whitespace and strips control/zero-width characters", () => {
    expect(cleanText("  Acme​   Clinic\t\n ")).toBe("Acme Clinic");
    expect(cleanText("a\u0007b")).toBe("a b");
    expect(cleanText("   ")).toBeNull();
    expect(cleanText(null)).toBeNull();
  });
});

describe("normalizeEmail", () => {
  it("trims and lower-cases", () => {
    const r = normalizeEmail("  Jane.Doe@Acme-Clinic.Example ");
    expect(r).toMatchObject({
      ok: true,
      normalized: "jane.doe@acme-clinic.example",
      domain: "acme-clinic.example",
    });
  });
  it("accepts mailto: prefixes and angle brackets", () => {
    expect(normalizeEmail("mailto:a@b.example")).toMatchObject({
      ok: true,
      normalized: "a@b.example",
    });
    expect(normalizeEmail("<a@b.example>")).toMatchObject({ ok: true, normalized: "a@b.example" });
  });
  it.each([
    ["jane@clinic", "no TLD"],
    ["jane@@clinic.example", "double @"],
    ["jane clinic@x.example", "space"],
    ["jane@.example", "empty label"],
    [".jane@x.example", "leading dot"],
    ["ja..ne@x.example", "consecutive dots"],
    ["jane@x.e", "1-char TLD"],
    ["jane@-x.example", "label starts with hyphen"],
  ])("rejects %s (%s) — never repaired", (value) => {
    expect(normalizeEmail(value)).toMatchObject({ ok: false, reason: "INVALID_FORMAT" });
  });
  it("detects multiple addresses in one cell", () => {
    expect(normalizeEmail("a@x.example; b@y.example")).toMatchObject({
      ok: false,
      reason: "MULTIPLE_EMAILS",
    });
  });
  it("reports empty values", () => {
    expect(normalizeEmail("  ")).toMatchObject({ ok: false, reason: "EMPTY" });
  });
});

describe("normalizeWebsite", () => {
  it("treats variants of the same site as one domain and keeps the original", () => {
    for (const v of [
      "company.example",
      "www.company.example",
      "https://company.example/",
      "HTTP://WWW.Company.Example/about?x=1",
    ]) {
      expect(normalizeWebsite(v).domain, v).toBe("company.example");
    }
    expect(normalizeWebsite("www.company.example").website).toBe("www.company.example");
  });
  it("keeps subdomains other than www", () => {
    expect(normalizeWebsite("https://clinics.company.example").domain).toBe(
      "clinics.company.example",
    );
  });
  it("flags unparseable or non-web values without inventing a domain", () => {
    expect(normalizeWebsite("not a website")).toMatchObject({
      domain: null,
      valid: false,
      website: "not a website",
    });
    expect(normalizeWebsite("ftp://files.example")).toMatchObject({ domain: null, valid: false });
    expect(normalizeWebsite("")).toEqual({ website: null, domain: null, valid: true });
  });
});

describe("URL safety", () => {
  it("only http(s) URLs are safe to link", () => {
    expect(isSafeHttpUrl("https://x.example/a")).toBe(true);
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("data:text/html,hi")).toBe(false);
    expect(isSafeHttpUrl("x.example")).toBe(false);
    expect(normalizeEvidenceUrl("javascript:alert(1)")).toEqual({
      url: "javascript:alert(1)",
      valid: false,
    });
  });
});

describe("normalizePhone", () => {
  it("keeps the number as written and flags implausible ones", () => {
    expect(normalizePhone("  +1 (555) 010-2030 ")).toEqual({
      phone: "+1 (555) 010-2030",
      plausible: true,
    });
    expect(normalizePhone("12")).toEqual({ phone: "12", plausible: false });
    expect(normalizePhone("call me")).toMatchObject({ plausible: false });
  });
});

describe("splitContactName", () => {
  it("drops honorifics and keeps multi-word surnames", () => {
    expect(splitContactName("Dr. Jane van der Berg")).toEqual({
      firstName: "Jane",
      lastName: "van der Berg",
    });
    expect(splitContactName("Avery")).toEqual({ firstName: "Avery", lastName: null });
    expect(splitContactName(null)).toEqual({ firstName: null, lastName: null });
  });
});

describe("parseIsoDate", () => {
  it("accepts ISO dates only", () => {
    expect(parseIsoDate("2026-09-15")?.toISOString()).toBe("2026-09-15T00:00:00.000Z");
    expect(parseIsoDate("2026-09-15T10:30:00Z")?.toISOString()).toBe("2026-09-15T10:30:00.000Z");
  });
  it("rejects ambiguous or impossible dates", () => {
    expect(parseIsoDate("03/04/2026")).toBeNull();
    expect(parseIsoDate("2026-02-31")).toBeNull();
    expect(parseIsoDate("15 Sept 2026")).toBeNull();
  });
});

describe("countries", () => {
  it.each([
    ["US", "US"],
    ["us", "US"],
    ["United States", "US"],
    ["USA", "US"],
    ["U.S.A.", "US"],
    ["United Kingdom", "GB"],
    ["UK", "GB"],
    ["Great Britain", "GB"],
    ["Nigeria", "NG"],
    ["Germany", "DE"],
    ["Canada", "CA"],
  ])("%s → %s", (input, code) => {
    expect(normalizeCountry(input)).toMatchObject({ code, recognized: true });
  });
  it("never guesses: unknown or ambiguous values stay unknown", () => {
    for (const v of ["America", "Narnia", "XX", "ZZ", "EU"]) {
      expect(normalizeCountry(v), v).toMatchObject({ code: null, recognized: false });
    }
  });
  it("blank is unknown, not a default", () => {
    expect(normalizeCountry("")).toEqual({ code: null, recognized: true, original: null });
  });
  it("names countries", () => {
    expect(countryName("NG")).toBe("Nigeria");
  });
});

describe("regions", () => {
  it("maps exact US/CA codes and names only", () => {
    expect(normalizeRegion("TX", "US")).toBe("US-TX");
    expect(normalizeRegion("texas", "US")).toBe("US-TX");
    expect(normalizeRegion("Ontario", "CA")).toBe("CA-ON");
    expect(normalizeRegion("Tex", "US")).toBeNull();
    expect(normalizeRegion("Lagos", "NG")).toBeNull();
    expect(normalizeRegion("TX", null)).toBeNull();
  });
});

describe("email-domain classification", () => {
  it("CONSUMER for known consumer providers, including country variants", () => {
    for (const d of [
      "gmail.com",
      "yahoo.co.uk",
      "hotmail.fr",
      "outlook.com",
      "icloud.com",
      "proton.me",
    ]) {
      expect(classifyEmailDomain(d, "acme.example"), d).toBe("CONSUMER");
    }
  });
  it("BUSINESS only with positive evidence (matches the company website)", () => {
    expect(classifyEmailDomain("acme.example", "acme.example")).toBe("BUSINESS");
    expect(classifyEmailDomain("mail.acme.example", "acme.example")).toBe("BUSINESS");
  });
  it("UNKNOWN otherwise — never assumed to be business", () => {
    expect(classifyEmailDomain("acme-group.example", "acme.example")).toBe("UNKNOWN");
    expect(classifyEmailDomain("acme.example", null)).toBe("UNKNOWN");
    expect(classifyEmailDomain(null, "acme.example")).toBe("UNKNOWN");
    expect(classifyEmailDomain("notacme.example", "acme.example")).toBe("UNKNOWN");
  });
  it("recognizes shared/role mailboxes", () => {
    expect(isRoleAddress("info")).toBe(true);
    expect(isRoleAddress("Sales+leads")).toBe(true);
    expect(isRoleAddress("jane.doe")).toBe(false);
  });
});

describe("suppression values", () => {
  it("normalizes emails and domains", () => {
    expect(normalizeSuppressionValue("email", " Jane@X.Example ")).toEqual({
      ok: true,
      value: "jane@x.example",
    });
    expect(normalizeSuppressionValue("domain", "https://www.Competitor.Example/about")).toEqual({
      ok: true,
      value: "competitor.example",
    });
    expect(normalizeSuppressionValue("domain", "@x.example")).toEqual({
      ok: true,
      value: "x.example",
    });
    expect(normalizeSuppressionValue("domain", "not a domain").ok).toBe(false);
    expect(normalizeSuppressionValue("email", "nope").ok).toBe(false);
  });
});
