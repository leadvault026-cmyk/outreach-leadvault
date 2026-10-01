import { describe, expect, it } from "vitest";
import type { MailboxConnection, OutboundMessage } from "@/providers/mailbox/contract";
import { PROVIDER_ERROR_CODES } from "@/providers/mailbox/contract";
import { classifySendFailure, providerError } from "@/providers/mailbox/errors";
import { FakeMailboxProvider } from "@/providers/mailbox/fake";
import { getMailboxProvider, ProviderNotAvailableError } from "@/providers/mailbox/registry";

const conn: MailboxConnection = {
  mailboxId: "mb-1",
  emailAddress: "alex@outreach.example",
  config: {},
};
const msg = (n: number): OutboundMessage => ({
  from: { email: "alex@outreach.example", name: "Alex" },
  to: `prospect${n}@company.example`,
  subject: "Hello",
  textBody: "Hi",
  messageId: `<m${n}@outreach.example>`,
  lvMessageId: `lv-${n}`,
});

describe("send outcome classification (§12.1)", () => {
  it("a definite protocol rejection is rejected_not_sent", () => {
    const r = classifySendFailure({
      dispatched: true,
      definiteRejection: { code: "RECIPIENT_REJECTED", status: 550 },
    });
    expect(r.outcome).toBe("rejected_not_sent");
    expect(r.error).toMatchObject({
      code: "RECIPIENT_REJECTED",
      retryable: false,
      providerStatus: 550,
    });
  });

  it("a failure before dispatch is rejected_not_sent (safe to retry)", () => {
    const r = classifySendFailure({ dispatched: false, transportCode: "CONNECTION_FAILED" });
    expect(r.outcome).toBe("rejected_not_sent");
    expect(r.error.retryable).toBe(true);
  });

  it("a timeout or reset after dispatch is AMBIGUOUS — never treated as not sent", () => {
    for (const transportCode of [
      "TIMEOUT",
      "CONNECTION_FAILED",
      "PROVIDER_UNAVAILABLE",
      undefined,
    ] as const) {
      expect(classifySendFailure({ dispatched: true, transportCode }).outcome).toBe("ambiguous");
    }
  });

  it("user-safe messages exist for every code and never echo provider detail", () => {
    for (const code of PROVIDER_ERROR_CODES) {
      const e = providerError(code);
      expect(e.safeMessage.length).toBeGreaterThan(10);
      expect(e.safeMessage).not.toMatch(/password|token|smtp\.|stack/i);
    }
  });
});

describe("FakeMailboxProvider honours the contract", () => {
  it("accepts by default and records delivery", async () => {
    const p = new FakeMailboxProvider();
    const r = await p.sendMessage(conn, msg(1));
    expect(r.outcome).toBe("accepted");
    expect(p.delivered).toHaveLength(1);
  });

  it("scripted rejection does not deliver", async () => {
    const p = new FakeMailboxProvider().scriptSends({
      kind: "reject",
      code: "RATE_LIMITED",
      status: 429,
    });
    const r = await p.sendMessage(conn, msg(1));
    expect(r).toMatchObject({
      outcome: "rejected_not_sent",
      error: { code: "RATE_LIMITED", retryable: true },
    });
    expect(p.delivered).toHaveLength(0);
  });

  it("reports positive sent evidence only for messages that really went out (ambiguous-but-sent)", async () => {
    const p = new FakeMailboxProvider().scriptSends(
      { kind: "ambiguous", actuallySent: true },
      { kind: "ambiguous", actuallySent: false },
    );
    const checkpoint = await p.getSendCheckpoint(conn);
    const a = await p.sendMessage(conn, msg(1));
    const b = await p.sendMessage(conn, msg(2));
    expect(a.outcome).toBe("ambiguous");
    expect(b.outcome).toBe("ambiguous");

    const evidenceA = await p.getMessageStatus(
      conn,
      { messageId: "<m1@outreach.example>", lvMessageId: "lv-1" },
      checkpoint,
    );
    const evidenceB = await p.getMessageStatus(
      conn,
      { messageId: "<m2@outreach.example>", lvMessageId: "lv-2" },
      checkpoint,
    );
    expect(evidenceA.found).toBe(true);
    // "Not found" is "no evidence yet", which the engine must NOT treat as proof of non-delivery.
    expect(evidenceB).toEqual({ found: false, checkedSources: ["sent_history"] });
  });

  it("matches sent evidence by the X-LV-Message-Id when the Message-ID differs", async () => {
    const p = new FakeMailboxProvider();
    await p.sendMessage(conn, msg(7));
    const ev = await p.getMessageStatus(
      conn,
      { messageId: "<rewritten@provider>", lvMessageId: "lv-7" },
      null,
    );
    expect(ev.found).toBe(true);
  });

  it("pages inbound messages with an opaque cursor", async () => {
    const p = new FakeMailboxProvider();
    const inbound = (id: string) => ({
      providerMessageId: id,
      receivedAt: new Date(),
      from: "x@company.example",
      to: [conn.emailAddress],
      subject: "Re: Hello",
      messageId: `<${id}>`,
      inReplyTo: "<m1@outreach.example>",
      references: [],
      headers: {},
      textBody: "Thanks",
    });
    p.injectInbound(conn.mailboxId, inbound("r1"));
    const first = await p.listInboundMessages(conn, null);
    expect(first.items.map((i) => i.providerMessageId)).toEqual(["r1"]);
    p.injectInbound(conn.mailboxId, inbound("r2"));
    const second = await p.listInboundMessages(conn, first.nextCursor);
    expect(second.items.map((i) => i.providerMessageId)).toEqual(["r2"]);
  });

  it("surfaces connection and health failures as normalized errors", async () => {
    const p = new FakeMailboxProvider();
    p.connectionHealthy = false;
    const check = await p.verifyConnection();
    expect(check.ok).toBe(false);
    expect((await p.getMailboxHealth()).status).toBe("unavailable");
  });
});

describe("registry", () => {
  it("has no live adapter in Phase 1 and fails explicitly", () => {
    expect(() => getMailboxProvider("smtp_imap")).toThrow(ProviderNotAvailableError);
  });
});
