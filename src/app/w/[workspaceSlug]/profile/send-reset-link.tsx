"use client";

import { useActionState } from "react";
import { requestPasswordResetAction, type FormState } from "@/app/(auth)/actions";
import { InlineAlert } from "@/components/states/inline-alert";
import { Button } from "@/components/ui/button";

export function SendResetLink({ email }: { email: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(requestPasswordResetAction, {
    status: "idle",
  });
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="email" value={email} />
      {state.status === "success" ? (
        <InlineAlert tone="success">{state.message}</InlineAlert>
      ) : null}
      {state.status === "error" ? (
        <InlineAlert tone="danger">Could not send the link. Try again shortly.</InlineAlert>
      ) : null}
      <Button type="submit" variant="outline" disabled={pending || !email}>
        {pending ? "Sending…" : "Email me a password reset link"}
      </Button>
    </form>
  );
}
