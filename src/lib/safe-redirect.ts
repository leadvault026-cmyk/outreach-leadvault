/**
 * Only same-origin, absolute-path redirects are allowed after sign-in (prevents open redirects
 * such as `?next=//evil.example` or `?next=https://evil.example`).
 */
export function safeNextPath(next: unknown, fallback = "/dashboard"): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 512) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(next)) return fallback;
  if (/^\/(login|forgot-password|auth\/)/.test(next)) return fallback;
  return next;
}
