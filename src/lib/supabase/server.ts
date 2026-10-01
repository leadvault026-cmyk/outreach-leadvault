import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { serverEnv } from "@/env/server";

/**
 * Supabase client bound to the request's auth cookies (HTTP-only, managed by @supabase/ssr).
 * Used only for authentication — application data goes through Drizzle + RLS (src/db).
 */
export async function createSupabaseServerClient() {
  const env = serverEnv();
  const cookieStore = await cookies();
  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component: cookies are read-only there. The proxy refreshes
            // sessions, so this is safe to ignore.
          }
        },
      },
    },
  );
}
