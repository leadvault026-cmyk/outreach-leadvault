"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withUserContext } from "@/db/client";
import { workspaces } from "@/db/schema";
import { AUDIT_ACTIONS } from "@/domain/audit";
import { withCapability, type ActionResult } from "@/server/action-result";
import { recordUserAudit } from "@/server/audit";

const schema = z
  .string()
  .trim()
  .min(10, "Enter the full postal address (at least 10 characters).")
  .max(300);

/** The compliance postal address printed in every email footer (required to launch). */
export async function updatePostalAddressAction(
  workspaceSlug: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = schema.safeParse(formData.get("postalAddress") ?? "");
  if (!parsed.success)
    return {
      ok: false,
      error: parsed.error.issues[0]!.message,
      fieldErrors: { postalAddress: parsed.error.issues[0]!.message },
    };
  const result = await withCapability(workspaceSlug, "workspace.settings", async (ctx) =>
    withUserContext(ctx.user.userId, async (tx) => {
      await tx
        .update(workspaces)
        .set({ compliancePostalAddress: parsed.data, updatedAt: new Date() })
        .where(and(eq(workspaces.id, ctx.workspace.id)));
      await recordUserAudit(tx, ctx.user, {
        action: AUDIT_ACTIONS.workspaceUpdated,
        entityType: "workspace",
        entityId: ctx.workspace.id,
        workspaceId: ctx.workspace.id,
        metadata: { field: "compliance_postal_address" },
      });
      return { ok: true as const, data: undefined, message: "Postal address saved." };
    }),
  );
  if (result.ok) revalidatePath(`/w/${workspaceSlug}/settings/workspace`);
  return result;
}
