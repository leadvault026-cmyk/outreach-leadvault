import type { ProviderKind } from "@/domain/enums";
import type { MailboxProvider } from "./contract";

/**
 * Resolves a provider adapter by connection kind. Only this module knows which concrete
 * adapters exist; domain code receives a `MailboxProvider`.
 *
 * Phase 1: no live adapter is registered. The generic SMTP/IMAP adapter (Mission Inbox primary,
 * Infraforge fallback) arrives in Phase 4 after the Phase 0 provider test (architecture §14.7.6).
 */
export class ProviderNotAvailableError extends Error {
  constructor(kind: string) {
    super(`Mailbox provider "${kind}" is not available in this build.`);
    this.name = "ProviderNotAvailableError";
  }
}

const adapters: Partial<Record<ProviderKind, () => MailboxProvider>> = {};

export function getMailboxProvider(kind: ProviderKind): MailboxProvider {
  const factory = adapters[kind];
  if (!factory) throw new ProviderNotAvailableError(kind);
  return factory();
}
