"use client";

import { useActionState } from "react";
import { Field } from "@/components/forms/field";
import { InlineAlert } from "@/components/states/inline-alert";
import { Button } from "@/components/ui/button";
import { updatePasswordAction, type FormState } from "../actions";

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(updatePasswordAction, {
    status: "idle",
  });
  return (
    <form action={action} className="mt-8 space-y-4" noValidate>
      {state.status === "error" && state.message ? (
        <InlineAlert tone="danger">{state.message}</InlineAlert>
      ) : null}
      <Field
        id="password"
        name="password"
        type="password"
        label="New password"
        autoComplete="new-password"
        hint="At least 12 characters, with uppercase, lowercase and a number."
        required
        error={state.fieldErrors?.password}
      />
      <Field
        id="confirm"
        name="confirm"
        type="password"
        label="Confirm new password"
        autoComplete="new-password"
        required
        error={state.fieldErrors?.confirm}
      />
      <Button type="submit" className="h-10 w-full" disabled={pending}>
        {pending ? "Saving…" : "Save new password"}
      </Button>
    </form>
  );
}
