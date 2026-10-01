/**
 * Inbound message classification (architecture §15, §17). Pure: works on the normalized
 * InboundMessage shape every provider adapter returns (and that the fake transport produces).
 */
export type InboundLike = {
  from: string;
  subject: string | null;
  inReplyTo: string | null;
  references: readonly string[];
  headers: Readonly<Record<string, string>>;
  textBody: string | null;
};

export type BounceClass = "hard" | "soft" | "blocked" | "unknown";

export type InboundClassification =
  | {
      kind: "bounce_report";
      bounce: {
        class: BounceClass;
        status: string | null;
        /** Message-ID of the original message, when the report quotes it. */
        originalMessageId: string | null;
        finalRecipient: string | null;
      };
    }
  | { kind: "auto_reply" }
  | { kind: "unsubscribe_request" }
  | { kind: "human_reply" };

const header = (h: Readonly<Record<string, string>>, name: string) => {
  const key = Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? h[key]! : null;
};

/** RFC 3463 status → class. Only clear "address does not exist" codes are hard bounces. */
export function bounceClass(status: string | null): BounceClass {
  if (!status) return "unknown";
  if (/^5\.1\.\d+$/.test(status) || status === "5.4.1") return "hard";
  if (/^5\.7\.\d+$/.test(status)) return "blocked";
  if (/^4\.\d+\.\d+$/.test(status) || status === "5.2.2") return "soft";
  return "unknown";
}

const OPT_OUT =
  /\b(unsubscribe|remove me|take me off|stop (e-?mailing|contacting|sending)|opt[ -]?out|do not (contact|email))\b/i;

/** The reply's own text: quoted lines (">") and everything after a "wrote:" separator removed. */
export function ownText(body: string | null): string {
  if (!body) return "";
  const cut = body.split(/\n\s*On .{0,200}wrote:\s*\n/i)[0] ?? body;
  return cut
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith(">"))
    .join("\n")
    .trim();
}

export function classifyInbound(msg: InboundLike): InboundClassification {
  const from = msg.from.toLowerCase();
  const contentType = header(msg.headers, "content-type") ?? "";
  if (/mailer-daemon|postmaster/.test(from) || /report-type="?delivery-status/i.test(contentType)) {
    const body = msg.textBody ?? "";
    const status = body.match(/^\s*Status:\s*([245]\.\d{1,3}\.\d{1,3})/im)?.[1] ?? null;
    const original = body.match(/^\s*Message-ID:\s*(<[^>\s]+>)/im)?.[1] ?? msg.inReplyTo ?? null;
    const finalRecipient =
      body.match(/^\s*Final-Recipient:\s*rfc822;\s*(\S+)/im)?.[1]?.toLowerCase() ?? null;
    return {
      kind: "bounce_report",
      bounce: { class: bounceClass(status), status, originalMessageId: original, finalRecipient },
    };
  }

  const autoSubmitted = header(msg.headers, "auto-submitted");
  const precedence = header(msg.headers, "precedence");
  if (
    (autoSubmitted && autoSubmitted.toLowerCase() !== "no") ||
    header(msg.headers, "x-autoreply") ||
    header(msg.headers, "x-autorespond") ||
    (precedence && /auto_reply|bulk|junk/i.test(precedence)) ||
    /\b(out of (the )?office|automatic reply|auto-?reply)\b/i.test(msg.subject ?? "")
  ) {
    return { kind: "auto_reply" };
  }

  if (OPT_OUT.test(ownText(msg.textBody).slice(0, 1000))) return { kind: "unsubscribe_request" };
  return { kind: "human_reply" };
}
