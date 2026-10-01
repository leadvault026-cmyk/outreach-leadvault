import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/safe-redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const OTP_TYPES: readonly EmailOtpType[] = [
  "recovery",
  "invite",
  "magiclink",
  "email",
  "email_change",
];

/**
 * Completes email links (password recovery, invitations). Supports the token_hash flow
 * (works across browsers/devices) and the PKCE code flow. On success the user has a session and
 * is sent to `next` (same-origin only); on failure, to /login with a generic notice.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const next = safeNextPath(searchParams.get("next"));
  const supabase = await createSupabaseServerClient();

  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");

  let ok = false;
  if (tokenHash && type && OTP_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    ok = !error;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  }

  const target = ok ? new URL(next, request.url) : new URL("/login?link=invalid", request.url);
  return NextResponse.redirect(target);
}
