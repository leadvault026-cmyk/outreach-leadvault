import { describe, expect, it } from "vitest";
import {
  buildVerificationRecord,
  effectiveVerificationStatus,
  normalizeVerificationLabel,
  verificationEligibility,
} from "@/domain/verification";

const NOW = new Date("2026-10-01T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("normalizeVerificationLabel", () => {
  it.each([
    ["valid", "VERIFIED"],
    ["Deliverable", "VERIFIED"],
    [" VERIFIED ", "VERIFIED"],
    ["invalid", "INVALID"],
    ["Undeliverable", "INVALID"],
    ["catch-all", "RISKY"],
    ["Catch All", "RISKY"],
    ["accept_all", "RISKY"],
    ["role-based", "RISKY"],
    ["unknown", "UNKNOWN"],
  ])("%s → %s", (label, expected) => {
    expect(normalizeVerificationLabel(label)).toBe(expected);
  });

  it("never treats unrecognized or missing labels as VERIFIED", () => {
    expect(normalizeVerificationLabel("probably fine")).toBe("UNKNOWN");
    expect(normalizeVerificationLabel("")).toBe("UNKNOWN");
    expect(normalizeVerificationLabel(null)).toBe("UNKNOWN");
    expect(normalizeVerificationLabel(undefined)).toBe("UNKNOWN");
  });
});

describe("buildVerificationRecord", () => {
  it("keeps a dated result with its source", () => {
    const r = buildVerificationRecord({
      label: "valid",
      verifiedAt: daysAgo(3),
      source: "research_import",
      now: NOW,
    });
    expect(r).toEqual({
      status: "VERIFIED",
      verifiedAt: daysAgo(3),
      source: "research_import",
      detail: "valid",
    });
  });

  it("downgrades an undated result to UNKNOWN but keeps the raw label", () => {
    const r = buildVerificationRecord({ label: "valid", verifiedAt: null, source: "x", now: NOW });
    expect(r.status).toBe("UNKNOWN");
    expect(r.verifiedAt).toBeNull();
    expect(r.detail).toBe("valid");
  });

  it("rejects future and invalid dates", () => {
    const future = new Date(NOW.getTime() + 86_400_000);
    expect(
      buildVerificationRecord({ label: "valid", verifiedAt: future, source: "x", now: NOW }).status,
    ).toBe("UNKNOWN");
    expect(
      buildVerificationRecord({
        label: "valid",
        verifiedAt: new Date("nope"),
        source: "x",
        now: NOW,
      }).status,
    ).toBe("UNKNOWN");
  });
});

describe("effectiveVerificationStatus", () => {
  it("ages VERIFIED and RISKY into STALE after the max age", () => {
    expect(
      effectiveVerificationStatus({ status: "VERIFIED", verifiedAt: daysAgo(10) }, { now: NOW }),
    ).toBe("VERIFIED");
    expect(
      effectiveVerificationStatus({ status: "VERIFIED", verifiedAt: daysAgo(91) }, { now: NOW }),
    ).toBe("STALE");
    expect(
      effectiveVerificationStatus({ status: "RISKY", verifiedAt: daysAgo(200) }, { now: NOW }),
    ).toBe("STALE");
    expect(
      effectiveVerificationStatus(
        { status: "VERIFIED", verifiedAt: daysAgo(31) },
        { now: NOW, maxAgeDays: 30 },
      ),
    ).toBe("STALE");
  });

  it("keeps INVALID as INVALID regardless of age", () => {
    expect(
      effectiveVerificationStatus({ status: "INVALID", verifiedAt: daysAgo(500) }, { now: NOW }),
    ).toBe("INVALID");
  });

  it("treats a VERIFIED record without a date as UNKNOWN", () => {
    expect(
      effectiveVerificationStatus({ status: "VERIFIED", verifiedAt: null }, { now: NOW }),
    ).toBe("UNKNOWN");
  });
});

describe("verificationEligibility", () => {
  it("only VERIFIED is ok; INVALID is ineligible; others need review", () => {
    expect(verificationEligibility("VERIFIED")).toEqual({ outcome: "ok" });
    expect(verificationEligibility("INVALID")).toEqual({
      outcome: "ineligible",
      reason: "EMAIL_VERIFICATION_FAILED",
    });
    for (const s of ["RISKY", "STALE", "UNKNOWN"] as const) {
      expect(verificationEligibility(s)).toEqual({ outcome: "review", reason: "EMAIL_UNVERIFIED" });
    }
  });
});
