import { describe, expect, it } from "vitest";
import { evaluateEligibility, REASONS, type EligibilityInput } from "@/domain/eligibility";
import type { PolicyRow } from "@/domain/jurisdiction";

const WS = "11111111-1111-7111-8111-111111111111";
const NOW = new Date("2026-10-01T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const allowUS: PolicyRow = {
  scope: "workspace",
  workspaceId: WS,
  countryCode: "US",
  regionCode: null,
  outreachStatus: "allowed",
  requiresPostalAddress: true,
  requiresUnsubscribeLink: true,
  footerTemplate: null,
};

/** A record that is ELIGIBLE when the US is allowed for this workspace. */
const good = (over: Partial<EligibilityInput> = {}): EligibilityInput => ({
  workspaceId: WS,
  companyName: "Acme Clinic",
  contactName: "Jane Doe",
  email: "jane@acme.example",
  emailNormalized: "jane@acme.example",
  emailDomain: "acme.example",
  websiteDomain: "acme.example",
  verificationStatus: "VERIFIED",
  verifiedAt: daysAgo(10),
  countryCode: "US",
  regionCode: "US-TX",
  suppressions: [],
  unsubscribed: false,
  policies: [allowUS],
  ...over,
});
const run = (over: Partial<EligibilityInput> = {}) => evaluateEligibility(good(over), { now: NOW });

describe("eligibility engine", () => {
  it("ELIGIBLE only when every rule passes", () => {
    expect(run()).toMatchObject({
      status: "ELIGIBLE",
      reasons: [],
      domainClass: "BUSINESS",
      verification: "VERIFIED",
    });
  });

  it("jurisdiction HOLD: with no policy everything is REVIEW, never eligible", () => {
    const r = run({ policies: [] });
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(r.reasons).toEqual(["JURISDICTION_REVIEW"]);
  });

  it("unknown country → COUNTRY_UNKNOWN review", () => {
    expect(run({ countryCode: null, regionCode: null })).toMatchObject({
      status: "NEEDS_REVIEW",
      reasons: ["COUNTRY_UNKNOWN"],
    });
  });

  it("blocked jurisdiction is INELIGIBLE", () => {
    const r = run({ policies: [{ ...allowUS, outreachStatus: "blocked" }] });
    expect(r).toMatchObject({ status: "INELIGIBLE", reasons: ["JURISDICTION_BLOCKED"] });
  });

  it.each([
    [{ email: null, emailNormalized: null, emailDomain: null }, "INELIGIBLE", "MISSING_EMAIL"],
    [
      { email: "jane@acme", emailNormalized: null, emailDomain: null },
      "INELIGIBLE",
      "INVALID_EMAIL",
    ],
    [{ verificationStatus: "INVALID" as const }, "INELIGIBLE", "EMAIL_VERIFICATION_FAILED"],
    [
      { emailNormalized: "jane@gmail.com", email: "jane@gmail.com", emailDomain: "gmail.com" },
      "INELIGIBLE",
      "CONSUMER_EMAIL_NOT_ALLOWED",
    ],
    [{ companyName: "  " }, "INELIGIBLE", "MISSING_REQUIRED_DATA"],
    [
      { verificationStatus: "UNKNOWN" as const, verifiedAt: null },
      "NEEDS_REVIEW",
      "EMAIL_NOT_VERIFIED",
    ],
    [{ verificationStatus: "RISKY" as const }, "NEEDS_REVIEW", "EMAIL_RISKY"],
    [{ verifiedAt: daysAgo(91) }, "NEEDS_REVIEW", "VERIFICATION_STALE"],
    [{ websiteDomain: "acme-group.example" }, "NEEDS_REVIEW", "EMAIL_DOMAIN_UNKNOWN"],
    [
      { emailNormalized: "info@acme.example", email: "info@acme.example" },
      "NEEDS_REVIEW",
      "ROLE_BASED_EMAIL",
    ],
    [{ contactName: null }, "NEEDS_REVIEW", "MISSING_CONTACT_NAME"],
  ])("%o → %s (%s)", (over, status, reason) => {
    const r = run(over as Partial<EligibilityInput>);
    expect(r.status).toBe(status);
    expect(r.reasons).toContain(reason);
  });

  it("verification freshness keeps the 90-day rule and reports when the decision expires", () => {
    expect(run({ verifiedAt: daysAgo(90) }).status).toBe("ELIGIBLE");
    expect(run({ verifiedAt: daysAgo(90.01) }).reasons).toContain("VERIFICATION_STALE");
    expect(run({ verifiedAt: daysAgo(10) }).expiresAt?.toISOString()).toBe(
      new Date(daysAgo(10).getTime() + 90 * 86_400_000).toISOString(),
    );
    expect(run({ verificationStatus: "UNKNOWN", verifiedAt: null }).expiresAt).toBeNull();
  });

  it("workspace and global suppression are SUPPRESSED and outrank everything", () => {
    const ws = run({
      suppressions: [{ scope: "workspace", reason: "MANUAL_DO_NOT_CONTACT", valueType: "email" }],
    });
    expect(ws).toMatchObject({ status: "SUPPRESSED", reasons: ["WORKSPACE_SUPPRESSION"] });
    const global = run({
      email: null,
      emailNormalized: null,
      suppressions: [{ scope: "global", reason: "HARD_BOUNCE", valueType: "domain" }],
    });
    expect(global.status).toBe("SUPPRESSED");
    expect(global.reasons).toEqual(expect.arrayContaining(["GLOBAL_SUPPRESSION", "MISSING_EMAIL"]));
  });

  it("unsubscribes make the record SUPPRESSED", () => {
    expect(run({ unsubscribed: true })).toMatchObject({
      status: "SUPPRESSED",
      reasons: ["UNSUBSCRIBED"],
    });
    const viaSuppression = run({
      suppressions: [{ scope: "workspace", reason: "UNSUBSCRIBE", valueType: "email" }],
    });
    expect(viaSuppression.reasons).toEqual(["WORKSPACE_SUPPRESSION", "UNSUBSCRIBED"]);
  });

  it("returns ALL applicable reasons in a stable order", () => {
    const r = run({
      policies: [],
      contactName: null,
      verificationStatus: "RISKY",
      websiteDomain: null,
    });
    expect(r.reasons).toEqual([
      "EMAIL_RISKY",
      "EMAIL_DOMAIN_UNKNOWN",
      "MISSING_CONTACT_NAME",
      "JURISDICTION_REVIEW",
    ]);
  });

  it("consumer email can be allowed only by explicit option", () => {
    const r = evaluateEligibility(
      good({
        emailNormalized: "jane@gmail.com",
        email: "jane@gmail.com",
        emailDomain: "gmail.com",
      }),
      { now: NOW, requireBusinessEmail: false },
    );
    expect(r.reasons).not.toContain("CONSUMER_EMAIL_NOT_ALLOWED");
  });

  it("every reason code has a plain-language label and explanation", () => {
    for (const [code, r] of Object.entries(REASONS)) {
      expect(r.label.length, code).toBeGreaterThan(3);
      expect(r.explanation.length, code).toBeGreaterThan(10);
    }
  });
});
