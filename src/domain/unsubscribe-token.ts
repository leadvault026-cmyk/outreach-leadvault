import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stateless unsubscribe tokens (architecture §19):
 *   v1.<base64url(message id)>.<base64url(HMAC-SHA256("v1:" + message id, secret))>
 * Unforgeable and non-enumerable; they resolve only to a message id. The key-id prefix ("v1")
 * allows rotation later.
 */
const VERSION = "v1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function mac(messageId: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(`${VERSION}:${messageId}`).digest();
}

export function signUnsubscribeToken(messageId: string, secret: string): string {
  if (secret.length < 32) throw new Error("The unsubscribe signing secret is too short.");
  return `${VERSION}.${Buffer.from(messageId).toString("base64url")}.${mac(messageId, secret).toString("base64url")}`;
}

/** Returns the message id for a valid token, otherwise null (never throws). */
export function verifyUnsubscribeToken(token: string, secret: string | undefined): string | null {
  if (!secret || secret.length < 32 || token.length > 200) return null;
  const [version, idPart, sigPart] = token.split(".");
  if (version !== VERSION || !idPart || !sigPart) return null;
  let messageId: string;
  try {
    messageId = Buffer.from(idPart, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!UUID_RE.test(messageId)) return null;
  const expected = mac(messageId, secret);
  const given = Buffer.from(sigPart, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return messageId;
}
