"use client";

import { useActionState } from "react";
import { Field } from "@/components/forms/field";
import { InlineAlert } from "@/components/states/inline-alert";
import { Button } from "@/components/ui/button";
import { requestPasswordResetAction, type FormState } from "../actions";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(requestPasswordResetAction, {
    status: "idle",
  });

  if (state.status === "success") {
    return (
      <InlineAlert tone="success" className="mt-8">
        {state.message}
      </InlineAlert>
    );
  }

  return (
    <form action={action} className="mt-8 space-y-4" noValidate>
      <Field
        id="email"
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        required
        error={state.fieldErrors?.email}
      />
      <Button type="submit" className="h-10 w-full" disabled={pending}>
        {pending ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  );
}
