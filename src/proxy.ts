import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Runs before every page request:
 *  1. assigns a request id (correlation for logs/support),
 *  2. sets a nonce-based Content-Security-Policy,
 *  3. refreshes the Supabase session cookie,
 *  4. redirects unauthenticated users away from protected routes.
 *
 * This is a convenience layer only — every page, server action and data call re-verifies the
 * session and workspace membership server-side (architecture §7, layer 1 vs layer 2).
 */

const PUBLIC_PATHS = [
  /^\/login$/,
  /^\/forgot-password$/,
  /^\/auth\/confirm$/,
  /^\/api\/health$/,
  // Recipient-facing unsubscribe (signed token; no login, reveals nothing about the prospect).
  /^\/u\/[A-Za-z0-9._-]{10,200}$/,
  /^\/api\/unsubscribe\/[A-Za-z0-9._-]{10,200}$/,
];
const AUTH_ONLY_PATHS = [/^\/login$/, /^\/forgot-password$/];

function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Inline style attributes are required by Radix positioning and chart rendering.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(process.env.APP_ENV === "production" ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

export async function proxy(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);

  const forward = () => {
    const headers = new Headers(request.headers);
    headers.set("x-request-id", requestId);
    headers.set("x-nonce", nonce);
    headers.set("Content-Security-Policy", csp);
    return NextResponse.next({ request: { headers } });
  };

  let response = forward();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  let isAuthenticated = false;

  if (url && key) {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = forward();
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    });
    // getClaims() validates the JWT (signature/expiry) and refreshes the session when needed.
    const { data } = await supabase.auth.getClaims();
    isAuthenticated = Boolean(data?.claims?.sub);
  }

  const { pathname, search } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((re) => re.test(pathname));

  const redirectTo = (target: URL) => {
    const redirect = NextResponse.redirect(target);
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    redirect.headers.set("x-request-id", requestId);
    return redirect;
  };

  if (!isAuthenticated && !isPublic) {
    const login = new URL("/login", request.url);
    if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
    return redirectTo(login);
  }

  if (isAuthenticated && AUTH_ONLY_PATHS.some((re) => re.test(pathname))) {
    return redirectTo(new URL("/dashboard", request.url));
  }

  // Remember the last workspace visited (a preference only — membership is re-verified on use).
  const workspaceMatch = /^\/w\/([a-z0-9-]{2,48})(\/|$)/.exec(pathname);
  if (isAuthenticated && workspaceMatch) {
    response.cookies.set("lvo_last_ws", workspaceMatch[1]!, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.APP_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 180,
    });
  }

  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and image optimization.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt)$).*)",
  ],
};
