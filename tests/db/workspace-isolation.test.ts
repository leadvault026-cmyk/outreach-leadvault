import type { PGlite } from "@electric-sql/pglite";
import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import * as s from "@/db/schema";
import { uuidv7 } from "@/lib/ids";
import {
  asAnon,
  asUser,
  createAuthUser,
  createTestDatabase,
  pgErrorCode,
  type TestDb,
} from "./harness";

/**
 * CRITICAL GUARANTEE: WORKSPACE A MUST NOT BE ABLE TO ACCESS WORKSPACE B DATA.
 * These tests run the real migrations (schema + RLS policies + grants) on real PostgreSQL and
 * exercise them as the `authenticated` role exactly as the application does (runAsUser).
 */
let db: TestDb;
let client: PGlite;

const U = {
  ownerA: uuidv7(),
  adminA: uuidv7(),
  operatorA: uuidv7(),
  viewerA: uuidv7(),
  ownerB: uuidv7(),
  outsider: uuidv7(),
};
const WS_A = uuidv7();
const WS_B = uuidv7();
const PROSPECT_A = uuidv7();
const PROSPECT_B = uuidv7();
const CAMPAIGN_A = uuidv7();
const CAMPAIGN_B = uuidv7();
const CONNECTION_A = uuidv7();

beforeAll(async () => {
  ({ db, client } = await createTestDatabase());
  for (const [key, id] of Object.entries(U))
    await createAuthUser(client, id, `${key}@test.example`, key);

  // Fixtures are written with the privileged (table-owner) connection, as the seed/worker would.
  await db.insert(s.workspaces).values([
    { id: WS_A, name: "Workspace A", slug: "ws-a", defaultTimezone: "UTC" },
    { id: WS_B, name: "Workspace B", slug: "ws-b", defaultTimezone: "UTC" },
  ]);
  await db.insert(s.workspaceMembers).values([
    { workspaceId: WS_A, userId: U.ownerA, role: "OWNER" },
    { workspaceId: WS_A, userId: U.adminA, role: "ADMIN" },
    { workspaceId: WS_A, userId: U.operatorA, role: "OPERATOR" },
    { workspaceId: WS_A, userId: U.viewerA, role: "VIEWER" },
    { workspaceId: WS_B, userId: U.ownerB, role: "OWNER" },
  ]);
  await db.insert(s.prospects).values([
    {
      id: PROSPECT_A,
      workspaceId: WS_A,
      companyName: "Alpha Clinic",
      email: "a@alpha.example",
      emailNormalized: "a@alpha.example",
    },
    {
      id: PROSPECT_B,
      workspaceId: WS_B,
      companyName: "Beta Clinic",
      email: "b@beta.example",
      emailNormalized: "b@beta.example",
    },
  ]);
  await db.insert(s.campaigns).values([
    { id: CAMPAIGN_A, workspaceId: WS_A, name: "A active", status: "ACTIVE" },
    { id: CAMPAIGN_B, workspaceId: WS_B, name: "B draft", status: "DRAFT" },
  ]);
  await db.insert(s.providerConnections).values({
    id: CONNECTION_A,
    workspaceId: WS_A,
    provider: "smtp_imap",
    accountEmail: "ops@a.example",
    status: "active",
    encryptedCredentials: Buffer.from("ciphertext"),
    credentialsKeyVersion: 1,
  });
  await db.insert(s.suppressions).values([
    {
      scope: "workspace",
      workspaceId: WS_B,
      valueType: "email",
      valueNormalized: "secret-b@beta.example",
      reason: "MANUAL_DO_NOT_CONTACT",
      source: "manual",
    },
    {
      scope: "global",
      valueType: "email",
      valueNormalized: "bounced@nowhere.example",
      reason: "HARD_BOUNCE",
      source: "bounce",
    },
  ]);
  await db.insert(s.auditLogs).values({
    workspaceId: WS_B,
    actorType: "user",
    actorUserId: U.ownerB,
    action: "auth.signed_in",
    entityType: "user",
  });
});

describe("test controls (prove the harness exercises RLS)", () => {
  it("user context runs as role authenticated with the caller's id", async () => {
    const [row] = await asUser(db, U.ownerA, async (tx) => {
      const r = await tx.execute(sql`select current_user as role, app.current_user_id() as uid`);
      return (r as unknown as { rows: Array<{ role: string; uid: string }> }).rows;
    });
    expect(row).toEqual({ role: "authenticated", uid: U.ownerA });
  });

  it("the privileged connection sees both workspaces (so the filtering below is RLS, not missing data)", async () => {
    const rows = await db.select({ id: s.prospects.id }).from(s.prospects);
    expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining([PROSPECT_A, PROSPECT_B]));
  });
});

describe("cross-workspace reads are impossible", () => {
  it("a member sees only their own workspace", async () => {
    const seenByA = await asUser(db, U.ownerA, (tx) =>
      tx.select({ id: s.workspaces.id }).from(s.workspaces),
    );
    expect(seenByA.map((w) => w.id)).toEqual([WS_A]);
    const seenByB = await asUser(db, U.ownerB, (tx) =>
      tx.select({ id: s.workspaces.id }).from(s.workspaces),
    );
    expect(seenByB.map((w) => w.id)).toEqual([WS_B]);
  });

  it("workspace A cannot read workspace B prospects, even by id", async () => {
    const all = await asUser(db, U.ownerA, (tx) =>
      tx.select({ id: s.prospects.id }).from(s.prospects),
    );
    expect(all.map((p) => p.id)).toEqual([PROSPECT_A]);
    const direct = await asUser(db, U.ownerA, (tx) =>
      tx.select().from(s.prospects).where(eq(s.prospects.id, PROSPECT_B)),
    );
    expect(direct).toHaveLength(0);
  });

  it("an explicit workspace filter for B returns nothing for an A member", async () => {
    const rows = await asUser(db, U.ownerA, (tx) =>
      tx.select().from(s.campaigns).where(eq(s.campaigns.workspaceId, WS_B)),
    );
    expect(rows).toHaveLength(0);
  });

  it("B's workspace suppressions, members and audit entries are invisible to A", async () => {
    const supp = await asUser(db, U.ownerA, (tx) => tx.select().from(s.suppressions));
    expect(supp.map((r) => r.valueNormalized)).toEqual(["bounced@nowhere.example"]); // global only
    const members = await asUser(db, U.ownerA, (tx) =>
      tx.select().from(s.workspaceMembers).where(eq(s.workspaceMembers.workspaceId, WS_B)),
    );
    expect(members).toHaveLength(0);
    const audit = await asUser(db, U.ownerA, (tx) => tx.select().from(s.auditLogs));
    expect(audit).toHaveLength(0);
  });

  it("a user with no membership sees no business data at all", async () => {
    const counts = await asUser(db, U.outsider, async (tx) => ({
      workspaces: (await tx.select().from(s.workspaces)).length,
      prospects: (await tx.select().from(s.prospects)).length,
      campaigns: (await tx.select().from(s.campaigns)).length,
      suppressions: (await tx.select().from(s.suppressions)).length,
    }));
    expect(counts).toEqual({ workspaces: 0, prospects: 0, campaigns: 0, suppressions: 0 });
  });

  it("profiles of users in other workspaces are invisible", async () => {
    const rows = await asUser(db, U.ownerA, (tx) =>
      tx.select({ id: s.profiles.userId }).from(s.profiles),
    );
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual([U.ownerA, U.adminA, U.operatorA, U.viewerA].sort());
    expect(ids).not.toContain(U.ownerB);
  });
});

describe("cross-workspace writes are impossible", () => {
  it("A cannot insert a prospect into B (RLS rejects)", async () => {
    const code = await pgErrorCode(
      asUser(db, U.ownerA, (tx) =>
        tx.insert(s.prospects).values({ workspaceId: WS_B, companyName: "Injected" }),
      ),
    );
    expect(code).toBe("42501"); // insufficient_privilege / RLS violation
  });

  it("A cannot update or delete B's rows (zero rows affected)", async () => {
    const updated = await asUser(db, U.ownerA, (tx) =>
      tx
        .update(s.prospects)
        .set({ companyName: "Hacked" })
        .where(eq(s.prospects.id, PROSPECT_B))
        .returning(),
    );
    expect(updated).toHaveLength(0);
    const deleted = await asUser(db, U.ownerA, (tx) =>
      tx.delete(s.campaigns).where(eq(s.campaigns.id, CAMPAIGN_B)).returning(),
    );
    expect(deleted).toHaveLength(0);
    const [b] = await db.select().from(s.prospects).where(eq(s.prospects.id, PROSPECT_B));
    expect(b?.companyName).toBe("Beta Clinic");
  });

  it("A cannot move its own row into B", async () => {
    const code = await pgErrorCode(
      asUser(db, U.ownerA, (tx) =>
        tx.update(s.prospects).set({ workspaceId: WS_B }).where(eq(s.prospects.id, PROSPECT_A)),
      ),
    );
    expect(code).not.toBeNull();
  });

  it("A cannot add itself to B", async () => {
    const code = await pgErrorCode(
      asUser(db, U.ownerA, (tx) =>
        tx
          .insert(s.workspaceMembers)
          .values({ workspaceId: WS_B, userId: U.ownerA, role: "OWNER" }),
      ),
    );
    expect(code).toBe("42501");
  });

  it("composite tenant FKs block cross-workspace links even for privileged code", async () => {
    // Campaign in A + prospect in B: rejected by the (workspace_id, prospect_id) foreign key.
    const code = await pgErrorCode(
      db.insert(s.campaignRecipients).values({
        workspaceId: WS_A,
        campaignId: CAMPAIGN_A,
        prospectId: PROSPECT_B,
        emailNormalized: "b@beta.example",
        status: "QUEUED",
      }),
    );
    expect(code).toBe("23503"); // foreign_key_violation
  });
});

describe("role enforcement inside a workspace", () => {
  it("VIEWER can read but not write", async () => {
    const rows = await asUser(db, U.viewerA, (tx) => tx.select().from(s.prospects));
    expect(rows).toHaveLength(1);
    const code = await pgErrorCode(
      asUser(db, U.viewerA, (tx) =>
        tx.insert(s.prospects).values({ workspaceId: WS_A, companyName: "No" }),
      ),
    );
    expect(code).toBe("42501");
  });

  it("OPERATOR can write prospects but not mailbox configuration", async () => {
    await asUser(db, U.operatorA, (tx) =>
      tx.insert(s.prospects).values({ workspaceId: WS_A, companyName: "Operator Added" }),
    );
    const code = await pgErrorCode(
      asUser(db, U.operatorA, (tx) =>
        tx
          .update(s.workspaces)
          .set({ name: "Renamed" })
          .where(eq(s.workspaces.id, WS_A))
          .returning(),
      ).then((rows) => (rows.length === 0 ? Promise.reject({ code: "0rows" }) : rows)),
    );
    expect(code).toBe("0rows"); // workspace settings are OWNER-only
  });

  it("only OWNER changes workspace settings", async () => {
    const byAdmin = await asUser(db, U.adminA, (tx) =>
      tx
        .update(s.workspaces)
        .set({ name: "By admin" })
        .where(eq(s.workspaces.id, WS_A))
        .returning(),
    );
    expect(byAdmin).toHaveLength(0);
    const byOwner = await asUser(db, U.ownerA, (tx) =>
      tx
        .update(s.workspaces)
        .set({ name: "Workspace A" })
        .where(eq(s.workspaces.id, WS_A))
        .returning(),
    );
    expect(byOwner).toHaveLength(1);
  });

  it("ADMIN can manage members but cannot touch or grant OWNER", async () => {
    const demote = await asUser(db, U.adminA, (tx) =>
      tx
        .update(s.workspaceMembers)
        .set({ role: "VIEWER" })
        .where(
          and(eq(s.workspaceMembers.workspaceId, WS_A), eq(s.workspaceMembers.userId, U.ownerA)),
        )
        .returning(),
    );
    expect(demote).toHaveLength(0);
    const promote = await pgErrorCode(
      asUser(db, U.adminA, (tx) =>
        tx
          .update(s.workspaceMembers)
          .set({ role: "OWNER" })
          .where(
            and(
              eq(s.workspaceMembers.workspaceId, WS_A),
              eq(s.workspaceMembers.userId, U.operatorA),
            ),
          ),
      ),
    );
    expect(promote).toBe("42501");
    const ok = await asUser(db, U.adminA, (tx) =>
      tx
        .update(s.workspaceMembers)
        .set({ role: "OPERATOR" })
        .where(
          and(eq(s.workspaceMembers.workspaceId, WS_A), eq(s.workspaceMembers.userId, U.viewerA)),
        )
        .returning(),
    );
    expect(ok).toHaveLength(1);
    await db
      .update(s.workspaceMembers)
      .set({ role: "VIEWER" })
      .where(
        and(eq(s.workspaceMembers.workspaceId, WS_A), eq(s.workspaceMembers.userId, U.viewerA)),
      );
  });

  it("non-draft campaigns cannot be deleted", async () => {
    const deleted = await asUser(db, U.ownerA, (tx) =>
      tx.delete(s.campaigns).where(eq(s.campaigns.id, CAMPAIGN_A)).returning(),
    );
    expect(deleted).toHaveLength(0);
  });

  it("users cannot read engine-written tables' secrets or write send history", async () => {
    const secret = await pgErrorCode(
      asUser(db, U.ownerA, (tx) => tx.select().from(s.providerConnections)),
    );
    expect(secret).toBe("42501"); // encrypted_credentials is not granted
    const safe = await asUser(db, U.ownerA, (tx) =>
      tx
        .select({ id: s.providerConnections.id, status: s.providerConnections.status })
        .from(s.providerConnections),
    );
    expect(safe).toEqual([{ id: CONNECTION_A, status: "active" }]);
    const writeMessage = await pgErrorCode(
      asUser(db, U.ownerA, (tx) => tx.execute(sql`delete from app.messages`)),
    );
    expect(writeMessage).toBe("42501");
  });

  it("users cannot make themselves platform admins", async () => {
    const code = await pgErrorCode(
      asUser(db, U.ownerA, (tx) =>
        tx.update(s.profiles).set({ isPlatformAdmin: true }).where(eq(s.profiles.userId, U.ownerA)),
      ),
    );
    expect(code).toBe("42501");
  });

  it("global suppressions cannot be lifted or created by workspace users", async () => {
    const lifted = await asUser(db, U.ownerA, (tx) =>
      tx
        .update(s.suppressions)
        .set({ liftedAt: new Date(), liftReason: "x" })
        .where(eq(s.suppressions.scope, "global"))
        .returning(),
    );
    expect(lifted).toHaveLength(0);
    const created = await pgErrorCode(
      asUser(db, U.ownerA, (tx) =>
        tx.insert(s.suppressions).values({
          scope: "global",
          valueType: "email",
          valueNormalized: "x@y.example",
          reason: "COMPLIANCE",
          source: "manual",
        }),
      ),
    );
    expect(created).toBe("42501");
  });
});

describe("audit log integrity", () => {
  it("a user can record their own events only", async () => {
    await asUser(db, U.ownerA, (tx) =>
      tx.insert(s.auditLogs).values({
        workspaceId: WS_A,
        actorType: "user",
        actorUserId: U.ownerA,
        action: "auth.signed_in",
        entityType: "user",
      }),
    );
    const forged = await pgErrorCode(
      asUser(db, U.ownerA, (tx) =>
        tx.insert(s.auditLogs).values({
          workspaceId: WS_A,
          actorType: "user",
          actorUserId: U.adminA,
          action: "auth.signed_in",
          entityType: "user",
        }),
      ),
    );
    expect(forged).toBe("42501");
    const intoOtherWorkspace = await pgErrorCode(
      asUser(db, U.ownerA, (tx) =>
        tx.insert(s.auditLogs).values({
          workspaceId: WS_B,
          actorType: "user",
          actorUserId: U.ownerA,
          action: "auth.signed_in",
          entityType: "user",
        }),
      ),
    );
    expect(intoOtherWorkspace).toBe("42501");
  });

  it("is append-only even for the privileged table owner", async () => {
    expect(await pgErrorCode(db.update(s.auditLogs).set({ action: "auth.signed_out" }))).toBe(
      "42501",
    );
    expect(await pgErrorCode(db.delete(s.auditLogs))).toBe("42501");
  });

  it("only ADMIN+ can read the workspace audit log", async () => {
    const asViewer = await asUser(db, U.viewerA, (tx) =>
      tx.select().from(s.auditLogs).where(eq(s.auditLogs.workspaceId, WS_A)),
    );
    expect(asViewer).toHaveLength(0);
    const asAdmin = await asUser(db, U.adminA, (tx) =>
      tx.select().from(s.auditLogs).where(eq(s.auditLogs.workspaceId, WS_A)),
    );
    expect(asAdmin.length).toBeGreaterThan(0);
  });
});

describe("anonymous access (publishable key path)", () => {
  it("has no access to the app schema", async () => {
    const code = await pgErrorCode(
      asAnon(db, (tx) => tx.execute(sql`select * from app.prospects`)),
    );
    expect(code).toBe("42501");
  });
});

describe("auth.users → profiles sync", () => {
  it("creates a profile with the user's email for every new auth user", async () => {
    const id = uuidv7();
    await createAuthUser(client, id, "New.Person@Test.Example", "New Person");
    const [p] = await db.select().from(s.profiles).where(eq(s.profiles.userId, id));
    expect(p).toMatchObject({
      fullName: "New Person",
      email: "new.person@test.example",
      isPlatformAdmin: false,
    });
  });
});
