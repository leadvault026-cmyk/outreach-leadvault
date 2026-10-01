import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
      <p className="text-muted-foreground mt-1.5 text-sm">
        Enter your account email and we&apos;ll send you a link to choose a new password.
      </p>
      <ForgotPasswordForm />
      <p className="text-muted-foreground mt-6 text-center text-sm">
        <Link href="/login" className="underline-offset-2 hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
