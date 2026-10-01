"use server";

import { revalidatePath } from "next/cache";
import { withUserContext } from "@/db/client";
import { AUDIT_ACTIONS } from "@/domain/audit";
import { isUuid } from "@/lib/ids";
import { withCapability, type ActionResult } from "@/server/action-result";
import { recordUserAudit } from "@/server/audit";
import { mailboxSettingsSchema, updateMailboxSettings } from "@/services/mailbox-service";

export async function updateMailboxAction(
  workspaceSlug: string,
  mailboxId: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  if (!isUuid(mailboxId)) return { ok: false, error: "Mailbox not found." };
  const input = {
    dailySendLimit: formData.get("dailySendLimit"),
    minSecondsBetweenSends: formData.get("minSecondsBetweenSends"),
    enabled: formData.get("enabled") === "on",
  };
  const parsed = mailboxSettingsSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { ok: false, error: "Check the highlighted fields.", fieldErrors };
  }
  const result = await withCapability(workspaceSlug, "mailboxes.manage", async (ctx) =>
    withUserContext(ctx.user.userId, async (tx) => {
      const ok = await updateMailboxSettings(
        tx,
        { workspaceId: ctx.workspace.id },
        mailboxId,
        parsed.data,
      );
      if (!ok) return { ok: false as const, error: "Mailbox not found." };
      await recordUserAudit(tx, ctx.user, {
        action: AUDIT_ACTIONS.mailboxUpdated,
        entityType: "mailbox",
        entityId: mailboxId,
        workspaceId: ctx.workspace.id,
        metadata: parsed.data,
      });
      return { ok: true as const, data: undefined, message: "Mailbox settings saved." };
    }),
  );
  if (result.ok) revalidatePath(`/w/${workspaceSlug}/mailboxes`);
  return result;
}
