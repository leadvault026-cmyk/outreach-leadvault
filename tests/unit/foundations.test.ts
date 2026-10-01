import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MODULES } from "@/config/modules";
import { ALL_NAV_ITEMS, activeNavKey } from "@/config/navigation";
import { SETTINGS_SECTIONS } from "@/config/settings";
import { AUDIT_ACTIONS, sanitizeAuditMetadata } from "@/domain/audit";
import { isUuid, uuidv7 } from "@/lib/ids";
import { safeNextPath } from "@/lib/safe-redirect";

const APP = path.resolve(__dirname, "../../src/app");

describe("navigation has no dead ends", () => {
  it("every navigation item has a page", () => {
    for (const item of ALL_NAV_ITEMS) {
      const page = path.join(APP, "w", "[workspaceSlug]", item.segment, "page.tsx");
      expect(existsSync(page), `${item.segment} page`).toBe(true);
    }
    expect(existsSync(path.join(APP, "w", "[workspaceSlug]", "profile", "page.tsx"))).toBe(true);
  });

  it("every available settings section has its own page; planned ones use the section page", () => {
    for (const s of SETTINGS_SECTIONS) {
      const own = path.join(APP, "w", "[workspaceSlug]", "settings", s.key, "page.tsx");
      if (s.status === "available") expect(existsSync(own), s.key).toBe(true);
    }
    expect(
      existsSync(path.join(APP, "w", "[workspaceSlug]", "settings", "[section]", "page.tsx")),
    ).toBe(true);
  });

  it("every placeholder module has copy", () => {
    for (const key of Object.keys(MODULES)) {
      expect(
        ALL_NAV_ITEMS.some((i) => i.key === key),
        key,
      ).toBe(true);
    }
  });

  it("resolves the active item from the URL", () => {
    expect(activeNavKey("/w/acme/dashboard")).toBe("dashboard");
    expect(activeNavKey("/w/acme/settings/team")).toBe("settings");
    expect(activeNavKey("/w/acme/profile")).toBe("profile");
    expect(activeNavKey("/w/acme/unknown")).toBeNull();
  });
});

describe("safeNextPath (open-redirect protection)", () => {
  it.each([
    ["/w/acme/campaigns", "/w/acme/campaigns"],
    ["/w/acme/prospects?state=TX", "/w/acme/prospects?state=TX"],
    ["//evil.example", "/dashboard"],
    ["https://evil.example", "/dashboard"],
    ["/\\evil.example", "/dashboard"],
    ["javascript:alert(1)", "/dashboard"],
    ["/login", "/dashboard"],
    ["/auth/confirm", "/dashboard"],
    ["", "/dashboard"],
  ])("%s → %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
  it("rejects non-strings and control characters", () => {
    expect(safeNextPath(undefined)).toBe("/dashboard");
    expect(safeNextPath(42)).toBe("/dashboard");
    expect(safeNextPath("/a\nb")).toBe("/dashboard");
  });
});

describe("audit metadata sanitization", () => {
  it("drops credential-like and content keys entirely", () => {
    const out = sanitizeAuditMetadata({
      password: "hunter2",
      api_key: "sk_live",
      refreshToken: "abc",
      Authorization: "Bearer x",
      smtp_password: "x",
      body_text: "email content",
      campaign_name: "Q4",
      recipients: 12,
    });
    expect(out).toEqual({ campaign_name: "Q4", recipients: 12 });
  });

  it("flattens values, truncates long strings and drops nested objects", () => {
    const out = sanitizeAuditMetadata({
      nested: { a: 1 },
      list: ["a", { b: 2 }, 3],
      long: "x".repeat(800),
      when: new Date("2026-10-01T00:00:00Z"),
    });
    expect(out.nested).toBeUndefined();
    expect(out.list).toEqual(["a", 3]);
    expect(String(out.long).length).toBeLessThanOrEqual(501);
    expect(out.when).toBe("2026-10-01T00:00:00.000Z");
  });

  it("uses DB-valid action names", () => {
    for (const action of Object.values(AUDIT_ACTIONS)) {
      expect(action).toMatch(/^[a-z_]+(\.[a-z_]+)+$/);
    }
  });
});

describe("uuidv7", () => {
  it("produces valid, version-7, time-ordered ids", () => {
    const a = uuidv7(1_000);
    const b = uuidv7(2_000);
    expect(isUuid(a)).toBe(true);
    expect(a[14]).toBe("7");
    expect(["8", "9", "a", "b"]).toContain(a[19]);
    expect(a < b).toBe(true);
  });
  it("is unique within the same millisecond", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7(5_000)));
    expect(ids.size).toBe(1000);
  });
});
