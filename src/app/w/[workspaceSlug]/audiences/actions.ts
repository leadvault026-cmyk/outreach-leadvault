"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withUserContext } from "@/db/client";
import { AUDIT_ACTIONS } from "@/domain/audit";
import { isUuid } from "@/lib/ids";
import { withCapability, type ActionResult } from "@/server/action-result";
import { recordUserAudit } from "@/server/audit";
import {
  AudienceError,
  audienceInputSchema,
  createAudience,
  removeMembers,
  updateAudience,
} from "@/services/audience-service";

function fields(formData: FormData) {
  return {
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
  };
}

export async function createAudienceAction(
  workspaceSlug: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const input = fields(formData);
  const parsed = audienceInputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the details." };
  const result = await withCapability(
    workspaceSlug,
    "audiences.manage",
    async (ctx) =>
      withUserContext(ctx.user.userId, async (tx) => {
        const id = await createAudience(
          tx,
          { workspaceId: ctx.workspace.id, userId: ctx.user.userId },
          input,
        );
        await recordUserAudit(tx, ctx.user, {
          action: AUDIT_ACTIONS.audienceCreated,
          entityType: "audience",
          entityId: id,
          workspaceId: ctx.workspace.id,
          metadata: { name: parsed.data.name },
        });
        return { ok: true as const, data: { id } };
      }),
    [AudienceError],
  );
  if (result.ok) redirect(`/w/${workspaceSlug}/audiences/${result.data.id}`);
  return result;
}

export async function updateAudienceAction(
  workspaceSlug: string,
  audienceId: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  if (!isUuid(audienceId)) return { ok: false, error: "Audience not found." };
  const input = fields(formData);
  const parsed = audienceInputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the details." };
  const result = await withCapability(
    workspaceSlug,
    "audiences.manage",
    async (ctx) =>
      withUserContext(ctx.user.userId, async (tx) => {
        await updateAudience(tx, { workspaceId: ctx.workspace.id }, audienceId, input);
        await recordUserAudit(tx, ctx.user, {
          action: AUDIT_ACTIONS.audienceUpdated,
          entityType: "audience",
          entityId: audienceId,
          workspaceId: ctx.workspace.id,
          metadata: { name: parsed.data.name },
        });
        return { ok: true as const, data: undefined, message: "Audience updated." };
      }),
    [AudienceError],
  );
  if (result.ok) revalidatePath(`/w/${workspaceSlug}/audiences/${audienceId}`);
  return result;
}

const removeSchema = z.object({ audienceId: z.uuid(), ids: z.array(z.uuid()).min(1).max(10_000) });

export async function removeMembersAction(
  workspaceSlug: string,
  input: z.input<typeof removeSchema>,
): Promise<ActionResult<{ removed: number }>> {
  const parsed = removeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "The selection could not be read." };
  const { audienceId, ids } = parsed.data;
  const result = await withCapability(workspaceSlug, "audiences.manage", async (ctx) =>
    withUserContext(ctx.user.userId, async (tx) => {
      const removed = await removeMembers(tx, { workspaceId: ctx.workspace.id }, audienceId, ids);
      await recordUserAudit(tx, ctx.user, {
        action: AUDIT_ACTIONS.audienceMembersRemoved,
        entityType: "audience",
        entityId: audienceId,
        workspaceId: ctx.workspace.id,
        metadata: { removed },
      });
      return { ok: true as const, data: { removed } };
    }),
  );
  if (result.ok) revalidatePath(`/w/${workspaceSlug}/audiences/${audienceId}`);
  return result;
}
