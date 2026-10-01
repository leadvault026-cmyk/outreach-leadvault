"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Field } from "@/components/forms/field";
import { InlineAlert } from "@/components/states/inline-alert";
import { Button } from "@/components/ui/button";
import { signInAction, type FormState } from "../actions";

export function LoginForm({
  next,
  notice,
  noticeTone,
}: {
  next?: string;
  notice?: string;
  noticeTone: "info" | "warning";
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(signInAction, {
    status: "idle",
  });

  return (
    <form action={action} className="mt-8 space-y-4" noValidate>
      {notice && state.status === "idle" ? (
        <InlineAlert tone={noticeTone}>{notice}</InlineAlert>
      ) : null}
      {state.status === "error" && state.message ? (
        <InlineAlert tone="danger">{state.message}</InlineAlert>
      ) : null}
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <Field
        id="email"
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        required
        error={state.fieldErrors?.email}
      />
      <div className="space-y-1.5">
        <Field
          id="password"
          name="password"
          type="password"
          label="Password"
          autoComplete="current-password"
          required
          error={state.fieldErrors?.password}
        />
        <div className="text-right">
          <Link
            href="/forgot-password"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Forgot password?
          </Link>
        </div>
      </div>
      <Button type="submit" className="h-10 w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
