import type { Metadata } from "next";
import { verifyUnsubscribeToken } from "@/domain/unsubscribe-token";
import { sendConfig } from "@/services/send-config";

export const metadata: Metadata = {
  title: "Email preferences",
  robots: { index: false, follow: false },
};

/**
 * Recipient-facing unsubscribe confirmation (architecture §19). GET never unsubscribes — link
 * scanners prefetch URLs — so the visitor confirms with a button (POST). Nothing about the
 * recipient, the sender's prospects or the campaign is shown.
 */
export default async function UnsubscribePage({ params, searchParams }: PageProps<"/u/[token]">) {
  const { token } = await params;
  const sp = await searchParams;
  const valid = Boolean(verifyUnsubscribeToken(token, sendConfig().unsubscribeSecret));

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 text-center">
        <h1 className="text-xl font-semibold">Email preferences</h1>
        {!valid ? (
          <p className="mt-3 text-sm text-muted-foreground">
            This link is not valid or has expired. If you keep receiving emails you do not want,
            reply to one of them with “unsubscribe”.
          </p>
        ) : sp.done === "1" ? (
          <p className="mt-3 text-sm" role="status">
            You have been unsubscribed. You will not receive further emails from this sender.
          </p>
        ) : (
          <form method="post" action={`/api/unsubscribe/${token}`} className="mt-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              Click below to stop receiving emails from this sender.
            </p>
            <input type="hidden" name="confirm" value="1" />
            <button
              type="submit"
              className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              Unsubscribe
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
