import { describe, expect, it } from "vitest";
import {
  canTransition,
  formatDelay,
  isWithinWindow,
  replySubject,
  splitDelay,
  zonedParts,
  zonedTimeToUtc,
} from "@/domain/campaigns";
import { composeMessage } from "@/domain/compose";
import { bounceClass, classifyInbound, ownText } from "@/domain/inbound";
import {
  prospectTokenValues,
  renderTemplate,
  tokensUsed,
  validateTemplateText,
} from "@/domain/personalization";

describe("personalization", () => {
  it("renders values and fallbacks, and reports missing fields instead of printing undefined", () => {
    const r = renderTemplate("Hi {{first_name}}, {{ company_name }} in {{city|your area}}", {
      first_name: "Ana",
      company_name: "Acme Clinic",
      city: "  ",
    });
    expect(r).toEqual({ text: "Hi Ana, Acme Clinic in your area", missing: [] });
    const m = renderTemplate("Hi {{first_name}} at {{company_name}}", { company_name: "Acme" });
    expect(m.missing).toEqual(["first_name"]);
    expect(m.text).not.toMatch(/undefined|null|\{\{/);
    expect(renderTemplate("Hi {{first_name|}},", {}).text).toBe("Hi ,");
  });

  it("rejects unknown and malformed tokens", () => {
    expect(validateTemplateText("Hi {{first_name|there}}")).toEqual([]);
    expect(validateTemplateText("Hi {{firstname}}")[0]!.code).toBe("UNKNOWN_TOKEN");
    expect(validateTemplateText("Hi {{ }}")[0]!.code).toBe("MALFORMED_TOKEN");
    expect(validateTemplateText("Hi {{first_name}")[0]!.code).toBe("MALFORMED_TOKEN");
    expect(validateTemplateText("Hi {first_name}}")[0]!.code).toBe("MALFORMED_TOKEN");
    expect(tokensUsed("{{city}} {{city|x}}", "{{company_name}}")).toEqual(["city", "company_name"]);
  });

  it("maps only existing normalized prospect fields", () => {
    const v = prospectTokenValues(
      {
        firstName: "Ana",
        lastName: "Ruiz",
        contactName: "Ana Ruiz",
        contactTitle: null,
        companyName: "Acme",
        businessType: "Dental Practice",
        city: "Austin",
        state: "TX",
        countryCode: "US",
        websiteDomain: "acme.example",
      },
      { name: "Alex" },
    );
    expect(v).toMatchObject({
      provider_type: "Dental Practice",
      country: "United States",
      sender_name: "Alex",
    });
    expect(v.contact_title).toBeNull();
  });
});

describe("message composition", () => {
  const first = {
    stepNumber: 1,
    subject: "Question for {{company_name}}",
    body: "Hi {{first_name|there}}",
  };
  const base = {
    firstStep: first,
    values: { company_name: "Acme", first_name: "Ana" },
    policyFooter: null,
    postalAddress: "1 Example St",
    requiresPostalAddress: true,
    unsubscribeUrl: "https://x.example/u/t",
  };
  it("adds the opt-out link and postal address to every email", () => {
    const c = composeMessage({ ...base, step: first });
    expect(c.subject).toBe("Question for Acme");
    expect(c.body).toBe(
      "Hi Ana\n\n--\n1 Example St\nIf you'd rather not hear from me again, opt out here: https://x.example/u/t\n",
    );
    expect(c.missingPostalAddress).toBe(false);
  });
  it("follow-ups without a subject reply in the same thread", () => {
    const c = composeMessage({
      ...base,
      step: { stepNumber: 2, subject: null, body: "Following up" },
    });
    expect(c).toMatchObject({ subject: "Re: Question for Acme", isReply: true });
    expect(replySubject("Re: x")).toBe("Re: x");
  });
  it("flags a missing required postal address", () => {
    expect(composeMessage({ ...base, step: first, postalAddress: null }).missingPostalAddress).toBe(
      true,
    );
  });
});

describe("campaign rules and time", () => {
  it("allows only defined transitions", () => {
    expect(canTransition("DRAFT", "launch")).toBe(true);
    expect(canTransition("ACTIVE", "launch")).toBe(false);
    expect(canTransition("ACTIVE", "pause")).toBe(true);
    expect(canTransition("PAUSED", "resume")).toBe(true);
    expect(canTransition("ACTIVE", "resume")).toBe(false);
    expect(canTransition("COMPLETED", "stop")).toBe(false);
    expect(canTransition("DRAFT", "stop")).toBe(false);
  });

  it("converts wall-clock times across DST", () => {
    expect(zonedTimeToUtc("2026-07-01", "09:00", "America/Chicago").toISOString()).toBe(
      "2026-07-01T14:00:00.000Z",
    );
    expect(zonedTimeToUtc("2026-12-01", "09:00", "America/Chicago").toISOString()).toBe(
      "2026-12-01T15:00:00.000Z",
    );
    expect(zonedTimeToUtc("2026-12-01", "09:00", "Europe/London").toISOString()).toBe(
      "2026-12-01T09:00:00.000Z",
    );
    expect(zonedParts(new Date("2026-10-05T15:00:00Z"), "America/Chicago")).toMatchObject({
      weekday: 1,
      hour: 10,
    });
  });

  it("checks sending windows in the campaign time zone", () => {
    const w = { days: [1, 2, 3, 4, 5], start: "08:00", end: "17:00" };
    const tz = "America/Chicago";
    expect(isWithinWindow(new Date("2026-10-05T15:00:00Z"), w, tz)).toBe(true); // Mon 10:00
    expect(isWithinWindow(new Date("2026-10-05T22:30:00Z"), w, tz)).toBe(false); // Mon 17:30
    expect(isWithinWindow(new Date("2026-10-10T15:00:00Z"), w, tz)).toBe(false); // Sat
    expect(
      isWithinWindow(new Date("2026-10-10T15:00:00Z"), { days: null, start: null, end: null }, tz),
    ).toBe(true);
  });

  it("formats sequence delays", () => {
    expect(splitDelay(4320)).toEqual({ value: 3, unit: "days" });
    expect(splitDelay(90)).toEqual({ value: 90, unit: "minutes" });
    expect(formatDelay(60)).toBe("1 hour");
    expect(formatDelay(2)).toBe("2 minutes");
  });
});

describe("inbound classification", () => {
  const base = {
    from: "ana@acme.example",
    subject: "Re: hello",
    inReplyTo: "<m@x>",
    references: [],
    headers: {},
    textBody: "Sounds good",
  };
  it("classifies human replies, auto-replies and opt-outs", () => {
    expect(classifyInbound(base).kind).toBe("human_reply");
    expect(classifyInbound({ ...base, headers: { "Auto-Submitted": "auto-replied" } }).kind).toBe(
      "auto_reply",
    );
    expect(classifyInbound({ ...base, subject: "Out of Office: hello" }).kind).toBe("auto_reply");
    expect(classifyInbound({ ...base, textBody: "Please remove me from your list" }).kind).toBe(
      "unsubscribe_request",
    );
    // Quoted text from our own email never triggers an opt-out.
    expect(
      classifyInbound({ ...base, textBody: "Thanks!\n> If you'd rather not hear… unsubscribe" })
        .kind,
    ).toBe("human_reply");
    expect(ownText("Yes\n\nOn Mon, X wrote:\n> old")).toBe("Yes");
  });
  it("parses delivery-status reports", () => {
    const c = classifyInbound({
      ...base,
      from: "MAILER-DAEMON@mail.example",
      headers: { "Content-Type": "multipart/report; report-type=delivery-status" },
      textBody:
        "Final-Recipient: rfc822; Ana@Acme.example\nAction: failed\nStatus: 5.1.1\n\nMessage-ID: <orig@x.example>",
    });
    expect(c).toEqual({
      kind: "bounce_report",
      bounce: {
        class: "hard",
        status: "5.1.1",
        originalMessageId: "<orig@x.example>",
        finalRecipient: "ana@acme.example",
      },
    });
    expect(bounceClass("4.2.2")).toBe("soft");
    expect(bounceClass("5.7.1")).toBe("blocked");
    expect(bounceClass("5.2.2")).toBe("soft");
    expect(bounceClass(null)).toBe("unknown");
  });
});

describe("campaign input schemas", () => {
  it("accept their own parsed output (validated in actions, re-parsed in services)", async () => {
    const { stepsInputSchema, campaignSettingsSchema } =
      await import("@/services/campaign-service");
    const steps = stepsInputSchema.parse([
      { subject: "Hello", body: "Hi", delayMinutes: 0 },
      { subject: "", body: "Following up", delayMinutes: 60 },
    ]);
    expect(steps[1]!.subject).toBeNull();
    expect(stepsInputSchema.parse(steps)).toEqual(steps);
    const settings = {
      name: "Test",
      description: "",
      audienceId: "01890000-0000-7000-8000-000000000001",
      mailboxId: "01890000-0000-7000-8000-000000000002",
      timezone: "UTC",
      startMode: "launch",
      anyTime: true,
      sendDays: [],
      windowStart: "08:00",
      windowEnd: "17:00",
    };
    const once = campaignSettingsSchema.parse(settings);
    expect(campaignSettingsSchema.parse(once)).toEqual(once);
  });
});
