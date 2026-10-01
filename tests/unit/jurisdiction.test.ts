import { describe, expect, it } from "vitest";
import {
  isSendableJurisdiction,
  resolveJurisdictionPolicy,
  type PolicyRow,
} from "@/domain/jurisdiction";

const WS = "11111111-1111-7111-8111-111111111111";
const OTHER_WS = "22222222-2222-7222-8222-222222222222";

const row = (
  p: Partial<PolicyRow> & Pick<PolicyRow, "countryCode" | "outreachStatus">,
): PolicyRow => ({
  scope: "global",
  workspaceId: null,
  regionCode: null,
  requiresPostalAddress: true,
  requiresUnsubscribeLink: true,
  footerTemplate: null,
  ...p,
});

describe("default HOLD behaviour (fail closed)", () => {
  it("resolves an unconfigured country to REVIEW and not sendable", () => {
    const r = resolveJurisdictionPolicy({ countryCode: "US", regionCode: "US-TX" }, WS, []);
    expect(r.outreachStatus).toBe("review");
    expect(r.matchedBy).toBe("default_review");
    expect(r.reason).toBe("JURISDICTION_REVIEW");
    expect(isSendableJurisdiction(r)).toBe(false);
  });

  it("resolves a missing or malformed country to REVIEW with COUNTRY_UNKNOWN", () => {
    for (const countryCode of [null, undefined, "", "USA", "1A"]) {
      const r = resolveJurisdictionPolicy({ countryCode }, WS, [
        row({ countryCode: "US", outreachStatus: "allowed" }),
      ]);
      expect(r.outreachStatus).toBe("review");
      expect(r.reason).toBe("COUNTRY_UNKNOWN");
      expect(isSendableJurisdiction(r)).toBe(false);
    }
  });

  it("is not US-only: any ISO country resolves through the same rules", () => {
    const policies = [row({ countryCode: "CA", outreachStatus: "blocked" })];
    expect(resolveJurisdictionPolicy({ countryCode: "ca" }, WS, policies).outreachStatus).toBe(
      "blocked",
    );
    expect(resolveJurisdictionPolicy({ countryCode: "DE" }, WS, policies).outreachStatus).toBe(
      "review",
    );
  });
});

describe("precedence", () => {
  const policies: PolicyRow[] = [
    row({ countryCode: "US", outreachStatus: "allowed" }),
    row({ countryCode: "US", regionCode: "US-CA", outreachStatus: "review" }),
    row({ scope: "workspace", workspaceId: WS, countryCode: "US", outreachStatus: "blocked" }),
    row({
      scope: "workspace",
      workspaceId: WS,
      countryCode: "US",
      regionCode: "US-TX",
      outreachStatus: "allowed",
    }),
    row({
      scope: "workspace",
      workspaceId: OTHER_WS,
      countryCode: "GB",
      outreachStatus: "allowed",
    }),
  ];

  it("workspace region beats everything", () => {
    const r = resolveJurisdictionPolicy({ countryCode: "US", regionCode: "US-TX" }, WS, policies);
    expect(r).toMatchObject({ outreachStatus: "allowed", matchedBy: "workspace_region" });
  });

  it("workspace country beats global rows", () => {
    const r = resolveJurisdictionPolicy({ countryCode: "US", regionCode: "US-NY" }, WS, policies);
    expect(r).toMatchObject({
      outreachStatus: "blocked",
      matchedBy: "workspace_country",
      reason: "JURISDICTION_BLOCKED",
    });
  });

  it("global region beats global country when no workspace row applies", () => {
    const r = resolveJurisdictionPolicy(
      { countryCode: "US", regionCode: "US-CA" },
      OTHER_WS,
      policies,
    );
    expect(r).toMatchObject({ outreachStatus: "review", matchedBy: "global_region" });
  });

  it("falls back to the global country row", () => {
    const r = resolveJurisdictionPolicy({ countryCode: "US" }, OTHER_WS, policies);
    expect(r).toMatchObject({ outreachStatus: "allowed", matchedBy: "global_country" });
    expect(isSendableJurisdiction(r)).toBe(true);
  });

  it("never applies another workspace's policy", () => {
    const r = resolveJurisdictionPolicy({ countryCode: "GB" }, WS, policies);
    expect(r).toMatchObject({ outreachStatus: "review", matchedBy: "default_review" });
  });
});
