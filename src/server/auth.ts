import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { isUuid } from "@/lib/ids";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type SessionUser = { userId: string; email: string | null };

/**
 * The verified user for this request, or null. getClaims() validates the access token
 * (signature + expiry) — the unverified session object is never trusted. Memoized per request.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (error || !isUuid(sub)) return null;
  const email = typeof data?.claims?.email === "string" ? data.claims.email : null;
  return { userId: sub, email };
});

/** Use in every protected page, layout and server action. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}
