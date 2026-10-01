import type { Metadata } from "next";
import { requireUser } from "@/server/auth";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Choose a new password" };

/** Reached through a recovery/invite link (/auth/confirm establishes the session). */
export default async function ResetPasswordPage() {
  const user = await requireUser();
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Setting a new password for <span className="font-medium text-foreground">{user.email}</span>
        .
      </p>
      <ResetPasswordForm />
    </>
  );
}
