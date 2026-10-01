import { NextResponse, type NextRequest } from "next/server";
import { systemDb } from "@/db/client";
import { verifyUnsubscribeToken } from "@/domain/unsubscribe-token";
import { logger } from "@/server/logger";
import { processUnsubscribe } from "@/services/inbound-service";
import { sendConfig } from "@/services/send-config";

/**
 * Unsubscribe endpoint (architecture §19): the target of the List-Unsubscribe header (RFC 8058
 * one-click POST from mail clients) and of the confirmation page's button. Idempotent; the token
 * is the only credential; responses never reveal who the recipient is.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/unsubscribe/[token]">) {
  const { token } = await ctx.params;
  const messageId = verifyUnsubscribeToken(token, sendConfig().unsubscribeSecret);
  const form = await request.formData().catch(() => null);
  const fromPage = form?.get("confirm") === "1";
  const pageUrl = new URL(`/u/${encodeURIComponent(token)}`, request.url);

  if (!messageId) {
    return fromPage
      ? NextResponse.redirect(pageUrl, 303)
      : new NextResponse("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  }
  try {
    const res = await processUnsubscribe(systemDb(), {
      messageId,
      method: fromPage ? "link_confirm" : "one_click_post",
      userAgent: request.headers.get("user-agent"),
    });
    if (!res.ok && !fromPage) return new NextResponse("Not found", { status: 404 });
  } catch (error) {
    logger.error("unsubscribe.failed", { error });
    return new NextResponse("Something went wrong. Please try again.", { status: 500 });
  }
  if (fromPage) {
    pageUrl.searchParams.set("done", "1");
    return NextResponse.redirect(pageUrl, 303);
  }
  return new NextResponse("Unsubscribed", {
    status: 200,
    headers: { "cache-control": "no-store" },
  });
}

/** GET never unsubscribes (scanners prefetch links); it shows the confirmation page. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/unsubscribe/[token]">) {
  const { token } = await ctx.params;
  return NextResponse.redirect(new URL(`/u/${encodeURIComponent(token)}`, request.url), 303);
}
