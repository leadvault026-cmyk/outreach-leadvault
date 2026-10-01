import type { ProviderError, ProviderErrorCode, SendResult } from "./contract";

const SAFE_MESSAGES: Record<ProviderErrorCode, string> = {
  AUTH_FAILED: "The mailbox rejected the stored credentials.",
  AUTH_EXPIRED: "The mailbox connection needs to be re-authorized.",
  RATE_LIMITED: "The provider is rate limiting this mailbox.",
  QUOTA_EXCEEDED: "The mailbox has reached its provider sending quota.",
  RECIPIENT_REJECTED: "The recipient address was rejected.",
  MESSAGE_REJECTED: "The provider rejected the message.",
  POLICY_BLOCKED: "The provider blocked the message by policy.",
  CONNECTION_FAILED: "Could not connect to the mail provider.",
  TIMEOUT: "The mail provider did not respond in time.",
  PROVIDER_UNAVAILABLE: "The mail provider is temporarily unavailable.",
  NOT_SUPPORTED: "This operation is not supported by the mailbox provider.",
  UNKNOWN: "An unexpected mail provider error occurred.",
};

const RETRYABLE: ReadonlySet<ProviderErrorCode> = new Set([
  "RATE_LIMITED",
  "QUOTA_EXCEEDED",
  "CONNECTION_FAILED",
  "TIMEOUT",
  "PROVIDER_UNAVAILABLE",
]);

/** Build a normalized error with a fixed user-safe message (raw details stay in server logs). */
export function providerError(code: ProviderErrorCode, providerStatus?: number): ProviderError {
  return {
    code,
    retryable: RETRYABLE.has(code),
    safeMessage: SAFE_MESSAGES[code],
    ...(providerStatus !== undefined ? { providerStatus } : {}),
  };
}

/**
 * Classify a failure per §12.1. `dispatched` = whether request bytes may have reached the
 * provider. Anything after dispatch without a definite rejection is AMBIGUOUS.
 */
export function classifySendFailure(input: {
  dispatched: boolean;
  /** Definite protocol-level rejection (HTTP 4xx, SMTP 4xx/5xx reply to MAIL/RCPT/DATA). */
  definiteRejection?: { code: ProviderErrorCode; status?: number };
  /** Transport failure code when no definite rejection was received. */
  transportCode?: ProviderErrorCode;
}): Exclude<SendResult, { outcome: "accepted" }> {
  if (input.definiteRejection) {
    return {
      outcome: "rejected_not_sent",
      error: providerError(input.definiteRejection.code, input.definiteRejection.status),
    };
  }
  const code = input.transportCode ?? "UNKNOWN";
  if (!input.dispatched) {
    return { outcome: "rejected_not_sent", error: providerError(code) };
  }
  return { outcome: "ambiguous", error: providerError(code) };
}
