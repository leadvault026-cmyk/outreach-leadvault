"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { withUserContext } from "@/db/client";
import { AUDIT_ACTIONS } from "@/domain/audit";
import { serverEnv } from "@/env/server";
import { safeNextPath } from "@/lib/safe-redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordUserAudit } from "@/server/audit";
import { getSessionUser, requireUser } from "@/server/auth";
import { logger } from "@/server/logger";

export type FormState = {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string>;
};

const emailSchema = z.email("Enter a valid email address.").max(254).trim().toLowerCase();

const PASSWORD_MIN_LENGTH = 12;
const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(128, "Use at most 128 characters.")
  .regex(/[a-z]/, "Include a lowercase letter.")
  .regex(/[A-Z]/, "Include an uppercase letter.")
  .regex(/[0-9]/, "Include a number.");

function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}

const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password.").max(128),
  next: z.string().optional(),
});

export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error || !data.user) {
    // One generic message: never reveal whether an account exists.
    const rateLimited = error?.status === 429;
    // A server-side failure of the auth service (5xx, or no HTTP status at all, e.g. its
    // database connection timed out) is not a wrong password and must not be reported as one.
    const serviceUnavailable = Boolean(error) && (!error?.status || error.status >= 500);
    if (serviceUnavailable)
      logger.warn("auth.sign_in_unavailable", { status: error?.status ?? null });
    return {
      status: "error",
      message: rateLimited
        ? "Too many sign-in attempts. Please wait a few minutes and try again."
        : serviceUnavailable
          ? "Couldn't reach the server. Check your connection and try again."
          : "The email or password is incorrect.",
    };
  }

  try {
    await withUserContext(data.user.id, (tx) =>
      recordUserAudit(
        tx,
        { userId: data.user.id, email: data.user.email ?? null },
        { action: AUDIT_ACTIONS.signedIn, entityType: "user", entityId: data.user.id },
      ),
    );
  } catch (auditError) {
    logger.error("audit.write_failed", { action: AUDIT_ACTIONS.signedIn, error: auditError });
  }

  redirect(safeNextPath(parsed.data.next));
}

export async function signOutAction(): Promise<void> {
  const user = await getSessionUser();
  if (user) {
    try {
      await withUserContext(user.userId, (tx) =>
        recordUserAudit(tx, user, {
          action: AUDIT_ACTIONS.signedOut,
          entityType: "user",
          entityId: user.userId,
        }),
      );
    } catch (auditError) {
      logger.error("audit.write_failed", { action: AUDIT_ACTIONS.signedOut, error: auditError });
    }
  }
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login?signed_out=1");
}

export async function requestPasswordResetAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = z.object({ email: emailSchema }).safeParse({ email: formData.get("email") });
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${serverEnv().APP_BASE_URL}/auth/confirm?next=/reset-password`,
  });
  if (error && error.status !== 429) {
    logger.warn("auth.password_reset_request_failed", { status: error.status });
  }

  // Same response whether or not the account exists (no account enumeration).
  return {
    status: "success",
    message:
      "If an account exists for that address, a password reset link is on its way. The link expires after one hour.",
  };
}

const updatePasswordSchema = z
  .object({ password: newPasswordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "The passwords do not match.",
  });

export async function updatePasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const parsed = updatePasswordSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    const sameAsOld = error.code === "same_password";
    return {
      status: "error",
      message: sameAsOld
        ? "Choose a password you have not used for this account."
        : "Your password could not be updated. Request a new reset link and try again.",
    };
  }

  try {
    await withUserContext(user.userId, (tx) =>
      recordUserAudit(tx, user, {
        action: AUDIT_ACTIONS.passwordChanged,
        entityType: "user",
        entityId: user.userId,
      }),
    );
  } catch (auditError) {
    logger.error("audit.write_failed", {
      action: AUDIT_ACTIONS.passwordChanged,
      error: auditError,
    });
  }

  redirect("/dashboard?password_updated=1");
}
