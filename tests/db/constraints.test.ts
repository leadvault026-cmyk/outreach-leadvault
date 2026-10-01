import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import * as s from "@/db/schema";
import { uuidv7 } from "@/lib/ids";
import { createTestDatabase, pgErrorCode, type TestDb } from "./harness";

/** Database-level integrity rules (architecture §4) — enforced regardless of application code. */
let db: TestDb;
const WS = uuidv7();
const CONN = uuidv7();
const MAILBOX = uuidv7();
const CAMPAIGN = uuidv7();
const PROSPECT = uuidv7();
const RECIPIENT = uuidv7();

beforeAll(async () => {
  ({ db } = await createTestDatabase());
  await db
    .insert(s.workspaces)
    .values({ id: WS, name: "W", slug: "w-constraints", defaultTimezone: "UTC" });
  await db.insert(s.providerConnections).values({
    id: CONN,
    workspaceId: WS,
    provider: "smtp_imap",
    accountEmail: "ops@w.example",
    status: "active",
    encryptedCredentials: Buffer.from("x"),
    credentialsKeyVersion: 1,
  });
  await db.insert(s.mailboxes).values({
    id: MAILBOX,
    workspaceId: WS,
    providerConnectionId: CONN,
    emailAddress: "a@w.example",
    displayName: "A",
    status: "CONNECTED",
    dailySendLimit: 30,
    timezone: "UTC",
    infraVendor: "test",
  });
  await db.insert(s.prospects).values({
    id: PROSPECT,
    workspaceId: WS,
    companyName: "P",
    email: "p@p.example",
    emailNormalized: "p@p.example",
  });
  await db
    .insert(s.campaigns)
    .values({ id: CAMPAIGN, workspaceId: WS, name: "C", status: "ACTIVE", mailboxId: MAILBOX });
  await db.insert(s.campaignRecipients).values({
    id: RECIPIENT,
    workspaceId: WS,
    campaignId: CAMPAIGN,
    prospectId: PROSPECT,
    emailNormalized: "p@p.example",
    status: "SENDING",
  });
});

const message = (overrides: Partial<typeof s.messages.$inferInsert> = {}) => {
  const id = uuidv7();
  return {
    id,
    workspaceId: WS,
    kind: "sequence" as const,
    campaignId: CAMPAIGN,
    campaignRecipientId: RECIPIENT,
    stepNumber: 1,
    mailboxId: MAILBOX,
    toEmail: "p@p.example",
    fromEmail: "a@w.example",
    subject: "S",
    bodyText: "B",
    rfcMessageId: `<${id}@w.example>`,
    lvMessageHeader: id,
    status: "PENDING" as const,
    scheduledFor: new Date(),
    ...overrides,
  };
};

describe("duplicate-send guard (architecture §12)", () => {
  it("allows exactly one sequence message per recipient per step", async () => {
    await db.insert(s.messages).values(message());
    expect(await pgErrorCode(db.insert(s.messages).values(message()))).toBe("23505");
    await db.insert(s.messages).values(message({ stepNumber: 2 }));
  });

  it("does not let a test send collide with the guard", async () => {
    await db
      .insert(s.messages)
      .values(
        message({ kind: "test", campaignId: null, campaignRecipientId: null, stepNumber: null }),
      );
  });

  it("requires SENT messages to carry sent_at", async () => {
    expect(
      await pgErrorCode(db.insert(s.messages).values(message({ stepNumber: 3, status: "SENT" }))),
    ).toBe("23514");
  });

  it("rejects unknown message statuses", async () => {
    expect(
      await pgErrorCode(
        db.insert(s.messages).values(message({ stepNumber: 4, status: "MAYBE" as never })),
      ),
    ).toBe("23514");
  });
});

describe("suppression rules (architecture §18)", () => {
  it("scope and workspace must agree", async () => {
    const bad = {
      valueType: "email" as const,
      valueNormalized: "x@x.example",
      reason: "COMPLIANCE" as const,
      source: "manual" as const,
    };
    expect(
      await pgErrorCode(
        db.insert(s.suppressions).values({ ...bad, scope: "global", workspaceId: WS }),
      ),
    ).toBe("23514");
    expect(
      await pgErrorCode(db.insert(s.suppressions).values({ ...bad, scope: "workspace" })),
    ).toBe("23514");
  });

  it("only one active suppression per value and scope; lifted rows may repeat", async () => {
    const row = {
      scope: "workspace" as const,
      workspaceId: WS,
      valueType: "email" as const,
      valueNormalized: "dup@x.example",
      reason: "UNSUBSCRIBE" as const,
      source: "manual" as const,
    };
    const [first] = await db.insert(s.suppressions).values(row).returning();
    expect(await pgErrorCode(db.insert(s.suppressions).values(row))).toBe("23505");
    await db
      .update(s.suppressions)
      .set({ liftedAt: new Date(), liftReason: "Requested by client" })
      .where(eq(s.suppressions.id, first!.id));
    await db.insert(s.suppressions).values(row);
  });

  it("requires normalized values and a reason when lifting", async () => {
    const base = {
      scope: "global" as const,
      valueType: "email" as const,
      reason: "HARD_BOUNCE" as const,
      source: "bounce" as const,
    };
    expect(
      await pgErrorCode(
        db.insert(s.suppressions).values({ ...base, valueNormalized: "Mixed@Case.example" }),
      ),
    ).toBe("23514");
    expect(
      await pgErrorCode(
        db
          .insert(s.suppressions)
          .values({ ...base, valueNormalized: "z@z.example", liftedAt: new Date() }),
      ),
    ).toBe("23514");
  });
});

describe("jurisdiction policies (architecture §10)", () => {
  it("enforces ISO formats and scope consistency", async () => {
    const base = { outreachStatus: "review" as const };
    expect(
      await pgErrorCode(
        db.insert(s.jurisdictionPolicies).values({ ...base, scope: "global", countryCode: "us" }),
      ),
    ).toBe("23514");
    expect(
      await pgErrorCode(
        db
          .insert(s.jurisdictionPolicies)
          .values({ ...base, scope: "global", countryCode: "US", regionCode: "Texas" }),
      ),
    ).toBe("23514");
    expect(
      await pgErrorCode(
        db
          .insert(s.jurisdictionPolicies)
          .values({ ...base, scope: "workspace", countryCode: "US" }),
      ),
    ).toBe("23514");
  });

  it("allows one policy per (scope, country, region)", async () => {
    await db
      .insert(s.jurisdictionPolicies)
      .values({ scope: "global", countryCode: "CA", outreachStatus: "review" });
    expect(
      await pgErrorCode(
        db
          .insert(s.jurisdictionPolicies)
          .values({ scope: "global", countryCode: "CA", outreachStatus: "allowed" }),
      ),
    ).toBe("23505");
    await db.insert(s.jurisdictionPolicies).values({
      scope: "global",
      countryCode: "CA",
      regionCode: "CA-ON",
      outreachStatus: "blocked",
    });
    await db.insert(s.jurisdictionPolicies).values({
      scope: "workspace",
      workspaceId: WS,
      countryCode: "CA",
      outreachStatus: "allowed",
    });
  });
});

describe("prospect data rules", () => {
  it("one prospect per normalized email per workspace", async () => {
    expect(
      await pgErrorCode(
        db
          .insert(s.prospects)
          .values({ workspaceId: WS, companyName: "Dup", emailNormalized: "p@p.example" }),
      ),
    ).toBe("23505");
  });

  it("requires normalized email and ISO country codes; no US default", async () => {
    expect(
      await pgErrorCode(
        db
          .insert(s.prospects)
          .values({ workspaceId: WS, companyName: "X", emailNormalized: " Upper@X.example" }),
      ),
    ).toBe("23514");
    expect(
      await pgErrorCode(
        db.insert(s.prospects).values({ workspaceId: WS, companyName: "X", countryCode: "us" }),
      ),
    ).toBe("23514");
    const [p] = await db
      .insert(s.prospects)
      .values({ workspaceId: WS, companyName: "No country" })
      .returning();
    expect(p?.countryCode).toBeNull();
  });

  it("verification results must carry date and source unless UNKNOWN", async () => {
    expect(
      await pgErrorCode(
        db
          .insert(s.prospects)
          .values({ workspaceId: WS, companyName: "V", emailVerificationStatus: "VERIFIED" }),
      ),
    ).toBe("23514");
    const [ok] = await db
      .insert(s.prospects)
      .values({
        workspaceId: WS,
        companyName: "V2",
        emailVerificationStatus: "VERIFIED",
        emailVerifiedAt: new Date(),
        emailVerificationSource: "research_import",
      })
      .returning();
    expect(ok?.emailVerificationStatus).toBe("VERIFIED");
    const [defaulted] = await db
      .insert(s.prospects)
      .values({ workspaceId: WS, companyName: "V3" })
      .returning();
    expect(defaulted?.emailVerificationStatus).toBe("UNKNOWN");
  });
});

describe("other integrity rules", () => {
  it("workspace slugs are lowercase URL-safe", async () => {
    expect(
      await pgErrorCode(
        db.insert(s.workspaces).values({ name: "Bad", slug: "Bad Slug", defaultTimezone: "UTC" }),
      ),
    ).toBe("23514");
  });

  it("mailbox daily limits and windows are bounded", async () => {
    const base = {
      workspaceId: WS,
      providerConnectionId: CONN,
      displayName: "M",
      status: "CONNECTED" as const,
      timezone: "UTC",
      infraVendor: "test",
    };
    expect(
      await pgErrorCode(
        db.insert(s.mailboxes).values({ ...base, emailAddress: "b@w.example", dailySendLimit: 0 }),
      ),
    ).toBe("23514");
    expect(
      await pgErrorCode(
        db.insert(s.mailboxes).values({
          ...base,
          emailAddress: "c@w.example",
          dailySendLimit: 10,
          windowStart: "18:00",
          windowEnd: "09:00",
        }),
      ),
    ).toBe("23514");
  });

  it("scheduled recipients must have a next step and time", async () => {
    const p = await db
      .insert(s.prospects)
      .values({ workspaceId: WS, companyName: "S" })
      .returning();
    expect(
      await pgErrorCode(
        db.insert(s.campaignRecipients).values({
          workspaceId: WS,
          campaignId: CAMPAIGN,
          prospectId: p[0]!.id,
          emailNormalized: "s@s.example",
          status: "SCHEDULED",
        }),
      ),
    ).toBe("23514");
  });

  it("the first sequence step must have a subject", async () => {
    expect(
      await pgErrorCode(
        db
          .insert(s.sequenceSteps)
          .values({ workspaceId: WS, campaignId: CAMPAIGN, stepNumber: 1, body: "B" }),
      ),
    ).toBe("23514");
    await db.insert(s.sequenceSteps).values({
      workspaceId: WS,
      campaignId: CAMPAIGN,
      stepNumber: 2,
      body: "Follow-up",
      threadMode: "reply",
    });
  });

  it("send-history rows cannot be deleted while referenced", async () => {
    expect(await pgErrorCode(db.delete(s.prospects).where(eq(s.prospects.id, PROSPECT)))).toBe(
      "23001",
    ); // restrict_violation
  });

  it("updated_at is maintained by trigger", async () => {
    const [before] = await db.select().from(s.workspaces).where(eq(s.workspaces.id, WS));
    await new Promise((r) => setTimeout(r, 15));
    const [after] = await db
      .update(s.workspaces)
      .set({ name: "W2" })
      .where(eq(s.workspaces.id, WS))
      .returning();
    expect(after!.updatedAt.getTime()).toBeGreaterThan(before!.updatedAt.getTime());
  });
});
