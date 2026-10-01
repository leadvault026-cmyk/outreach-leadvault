/**
 * Email-domain classification: BUSINESS | CONSUMER | UNKNOWN (Phase 2 §V).
 *
 * Deliberately conservative, with no paid dataset:
 *  - CONSUMER: the domain is a known consumer mailbox provider (list below — a deliberately
 *    partial list of large providers, extensible; it is NOT claimed to be comprehensive).
 *  - BUSINESS: positive evidence only — the email domain equals, or is a subdomain of, the
 *    researched company website's domain.
 *  - UNKNOWN: everything else. UNKNOWN is never treated as BUSINESS.
 */
export type EmailDomainClass = "BUSINESS" | "CONSUMER" | "UNKNOWN";

/** Exact consumer-mailbox domains. */
const CONSUMER_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "passport.com",
  "yahoo.com",
  "ymail.com",
  "rocketmail.com",
  "aol.com",
  "aim.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.net",
  "gmx.de",
  "web.de",
  "t-online.de",
  "mail.com",
  "email.com",
  "usa.com",
  "yandex.com",
  "yandex.ru",
  "mail.ru",
  "rambler.ru",
  "zohomail.com",
  "tutanota.com",
  "tuta.io",
  "fastmail.com",
  "hey.com",
  "qq.com",
  "163.com",
  "126.com",
  "sina.com",
  "naver.com",
  "daum.net",
  "comcast.net",
  "verizon.net",
  "att.net",
  "sbcglobal.net",
  "bellsouth.net",
  "cox.net",
  "charter.net",
  "earthlink.net",
  "optonline.net",
  "frontier.com",
  "windstream.net",
  "btinternet.com",
  "sky.com",
  "virginmedia.com",
  "talktalk.net",
  "orange.fr",
  "free.fr",
  "laposte.net",
  "libero.it",
  "wanadoo.fr",
  "shaw.ca",
  "rogers.com",
  "sympatico.ca",
  "bigpond.com",
  "optusnet.com.au",
  "rediffmail.com",
]);

/** Consumer providers that operate many country-code variants (yahoo.co.uk, hotmail.fr, …). */
const CONSUMER_FAMILIES = ["yahoo", "hotmail", "outlook", "live", "msn", "aol", "gmx", "yandex"];
const COUNTRY_SUFFIX = /^(?:[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/;

function isConsumerDomain(domain: string): boolean {
  if (CONSUMER_DOMAINS.has(domain)) return true;
  const [first, ...rest] = domain.split(".");
  return Boolean(first && CONSUMER_FAMILIES.includes(first) && COUNTRY_SUFFIX.test(rest.join(".")));
}

export function classifyEmailDomain(
  emailDomain: string | null | undefined,
  websiteDomain: string | null | undefined,
): EmailDomainClass {
  const d = emailDomain?.trim().toLowerCase();
  if (!d) return "UNKNOWN";
  if (isConsumerDomain(d)) return "CONSUMER";
  const w = websiteDomain?.trim().toLowerCase();
  if (w && (d === w || d.endsWith(`.${w}`))) return "BUSINESS";
  return "UNKNOWN";
}

/** Shared/role mailboxes reach a team, not a person — appropriate for review, not auto-send. */
const ROLE_LOCAL_PARTS = new Set([
  "info",
  "contact",
  "hello",
  "admin",
  "office",
  "sales",
  "support",
  "help",
  "enquiries",
  "inquiries",
  "team",
  "mail",
  "reception",
  "frontdesk",
  "billing",
  "accounts",
  "marketing",
  "noreply",
  "no-reply",
  "donotreply",
  "webmaster",
  "postmaster",
  "hostmaster",
  "abuse",
  "careers",
  "jobs",
  "hr",
  "privacy",
  "legal",
  "press",
  "media",
  "appointments",
  "scheduling",
]);

export function isRoleAddress(localPart: string | null | undefined): boolean {
  if (!localPart) return false;
  return ROLE_LOCAL_PARTS.has(localPart.toLowerCase().split("+")[0]!);
}
