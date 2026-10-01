import { describe, expect, it } from "vitest";
import { WORKSPACE_ROLES } from "@/domain/enums";
import {
  CAPABILITIES,
  can,
  canManageMember,
  hasRoleAtLeast,
  isWorkspaceRole,
} from "@/domain/permissions";

describe("role hierarchy", () => {
  it("orders OWNER > ADMIN > OPERATOR > VIEWER", () => {
    expect(hasRoleAtLeast("OWNER", "ADMIN")).toBe(true);
    expect(hasRoleAtLeast("ADMIN", "OPERATOR")).toBe(true);
    expect(hasRoleAtLeast("OPERATOR", "VIEWER")).toBe(true);
    expect(hasRoleAtLeast("VIEWER", "OPERATOR")).toBe(false);
    expect(hasRoleAtLeast("OPERATOR", "ADMIN")).toBe(false);
  });

  it("validates role strings", () => {
    expect(isWorkspaceRole("ADMIN")).toBe(true);
    expect(isWorkspaceRole("admin")).toBe(false);
    expect(isWorkspaceRole("SUPERUSER")).toBe(false);
    expect(isWorkspaceRole(undefined)).toBe(false);
  });
});

describe("capability matrix (architecture §7)", () => {
  const cases: Array<[string, Record<(typeof WORKSPACE_ROLES)[number], boolean>]> = [
    ["workspace.view", { OWNER: true, ADMIN: true, OPERATOR: true, VIEWER: true }],
    ["campaigns.manage", { OWNER: true, ADMIN: true, OPERATOR: true, VIEWER: false }],
    ["suppression.add", { OWNER: true, ADMIN: true, OPERATOR: true, VIEWER: false }],
    ["suppression.lift", { OWNER: true, ADMIN: true, OPERATOR: false, VIEWER: false }],
    ["mailboxes.manage", { OWNER: true, ADMIN: true, OPERATOR: false, VIEWER: false }],
    ["audit.view", { OWNER: true, ADMIN: true, OPERATOR: false, VIEWER: false }],
    ["workspace.settings", { OWNER: true, ADMIN: false, OPERATOR: false, VIEWER: false }],
  ];

  it.each(cases)("%s", (capability, expected) => {
    for (const role of WORKSPACE_ROLES) {
      expect(can(role, capability as keyof typeof CAPABILITIES), `${role} → ${capability}`).toBe(
        expected[role],
      );
    }
  });

  it("denies everything without a role", () => {
    for (const capability of Object.keys(CAPABILITIES) as Array<keyof typeof CAPABILITIES>) {
      expect(can(null, capability)).toBe(false);
      expect(can(undefined, capability)).toBe(false);
    }
  });
});

describe("team management", () => {
  it("lets OWNER manage anyone", () => {
    expect(canManageMember("OWNER", "OWNER", "ADMIN")).toBe(true);
  });
  it("prevents ADMIN from touching or granting OWNER", () => {
    expect(canManageMember("ADMIN", "OWNER")).toBe(false);
    expect(canManageMember("ADMIN", "OPERATOR", "OWNER")).toBe(false);
    expect(canManageMember("ADMIN", "OPERATOR", "ADMIN")).toBe(true);
  });
  it("prevents OPERATOR and VIEWER from managing members", () => {
    expect(canManageMember("OPERATOR", "VIEWER", "VIEWER")).toBe(false);
    expect(canManageMember("VIEWER", "VIEWER")).toBe(false);
  });
});
