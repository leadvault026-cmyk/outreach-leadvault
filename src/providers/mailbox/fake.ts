import type {
  ConnectionCheck,
  InboundBatch,
  InboundMessage,
  MailboxConnection,
  MailboxHealth,
  MailboxProvider,
  OutboundMessage,
  ProviderCapabilities,
  ProviderErrorCode,
  SendResult,
  SentEvidence,
} from "./contract";
import { providerError } from "./errors";

/**
 * Scriptable in-memory provider for tests and local development. It never touches the network.
 * Script send outcomes to exercise the engine's handling of acceptance, definite rejection and
 * ambiguity — including "ambiguous but actually sent" (timeout after the provider accepted).
 */
export type ScriptedSend =
  | { kind: "accept" }
  | { kind: "reject"; code: ProviderErrorCode; status?: number }
  | { kind: "ambiguous"; code?: ProviderErrorCode; actuallySent: boolean };

export class FakeMailboxProvider implements MailboxProvider {
  readonly kind = "fake";
  readonly capabilities: ProviderCapabilities = {
    sentHistoryLookup: true,
    messageStatusLookup: false,
    webhooks: false,
    preservesMessageId: true,
  };

  /** Messages the fake provider actually "delivered" (accepted, or ambiguous-but-sent). */
  readonly delivered: Array<{ mailboxId: string; message: OutboundMessage; at: Date }> = [];
  /** Every send call, in order, with its returned outcome. */
  readonly calls: Array<{ messageId: string; outcome: SendResult["outcome"] }> = [];

  private readonly script: ScriptedSend[] = [];
  private readonly inbound = new Map<string, InboundMessage[]>();
  private counter = 0;
  connectionHealthy = true;

  constructor(private readonly now: () => Date = () => new Date()) {}

  scriptSends(...outcomes: ScriptedSend[]): this {
    this.script.push(...outcomes);
    return this;
  }

  injectInbound(mailboxId: string, message: InboundMessage): void {
    const list = this.inbound.get(mailboxId) ?? [];
    list.push(message);
    this.inbound.set(mailboxId, list);
  }

  async verifyConnection(): Promise<ConnectionCheck> {
    return this.connectionHealthy
      ? { ok: true, checkedAt: this.now() }
      : { ok: false, checkedAt: this.now(), error: providerError("AUTH_FAILED") };
  }

  async getSendCheckpoint(conn: MailboxConnection): Promise<string> {
    return String(this.delivered.filter((d) => d.mailboxId === conn.mailboxId).length);
  }

  async sendMessage(conn: MailboxConnection, message: OutboundMessage): Promise<SendResult> {
    const step = this.script.shift() ?? { kind: "accept" };
    let result: SendResult;

    if (step.kind === "accept") {
      this.delivered.push({ mailboxId: conn.mailboxId, message, at: this.now() });
      result = {
        outcome: "accepted",
        providerMessageId: `fake-${++this.counter}`,
        acceptedAt: this.now(),
      };
    } else if (step.kind === "reject") {
      result = { outcome: "rejected_not_sent", error: providerError(step.code, step.status) };
    } else {
      if (step.actuallySent) {
        this.delivered.push({ mailboxId: conn.mailboxId, message, at: this.now() });
      }
      result = { outcome: "ambiguous", error: providerError(step.code ?? "TIMEOUT") };
    }

    this.calls.push({ messageId: message.messageId, outcome: result.outcome });
    return result;
  }

  async getMessageStatus(
    conn: MailboxConnection,
    ids: { messageId: string; lvMessageId: string },
    checkpoint: string | null,
  ): Promise<SentEvidence> {
    const since = checkpoint === null ? 0 : Number(checkpoint);
    const hit = this.delivered
      .filter((d) => d.mailboxId === conn.mailboxId)
      .slice(since)
      .find(
        (d) => d.message.messageId === ids.messageId || d.message.lvMessageId === ids.lvMessageId,
      );
    return hit
      ? { found: true, source: "sent_history", observedAt: hit.at }
      : { found: false, checkedSources: ["sent_history"] };
  }

  async listInboundMessages(conn: MailboxConnection, cursor: string | null): Promise<InboundBatch> {
    const all = this.inbound.get(conn.mailboxId) ?? [];
    const start = cursor === null ? 0 : Number(cursor);
    return { items: all.slice(start), nextCursor: String(all.length) };
  }

  async getMailboxHealth(): Promise<MailboxHealth> {
    return {
      status: this.connectionHealthy ? "healthy" : "unavailable",
      checkedAt: this.now(),
      checks: [{ name: "connection", ok: this.connectionHealthy }],
    };
  }
}
