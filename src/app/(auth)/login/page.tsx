import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : undefined;
  const notice =
    sp.link === "invalid"
      ? "That link is invalid or has expired. Request a new one."
      : sp.signed_out
        ? "You have been signed out."
        : undefined;

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="text-muted-foreground mt-1.5 text-sm">
        Use the account your LeadVault administrator created for you.
      </p>
      <LoginForm next={next} notice={notice} noticeTone={sp.link === "invalid" ? "warning" : "info"} />
    </>
  );
}
