"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withUserContext } from "@/db/client";
import { AUDIT_ACTIONS } from "@/domain/audit";
import { isUuid } from "@/lib/ids";
import { withCapability, type ActionResult } from "@/server/action-result";
import { recordUserAudit } from "@/server/audit";
import {
  archiveTemplate,
  createTemplate,
  TemplateError,
  updateTemplate,
} from "@/services/template-service";

function read(formData: FormData) {
  return {
    name: String(formData.get("name") ?? ""),
    subject: String(formData.get("subject") ?? ""),
    body: String(formData.get("body") ?? ""),
  };
}

function templateError(e: unknown): ActionResult<{ id: string }> | null {
  if (e instanceof TemplateError)
    return {
      ok: false,
      error: e.message,
      fieldErrors: e.field ? { [e.field]: e.message } : undefined,
    };
  return null;
}

export async function saveTemplateAction(
  workspaceSlug: string,
  templateId: string | null,
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  if (templateId && !isUuid(templateId)) return { ok: false, error: "Template not found." };
  const input = read(formData);
  const result = await withCapability(workspaceSlug, "templates.manage", async (ctx) => {
    try {
      return await withUserContext(ctx.user.userId, async (tx) => {
        const actor = { workspaceId: ctx.workspace.id, userId: ctx.user.userId };
        const id = templateId ?? (await createTemplate(tx, actor, input));
        if (templateId) await updateTemplate(tx, actor, templateId, input);
        await recordUserAudit(tx, ctx.user, {
          action: templateId ? AUDIT_ACTIONS.templateUpdated : AUDIT_ACTIONS.templateCreated,
          entityType: "template",
          entityId: id,
          workspaceId: ctx.workspace.id,
          metadata: { name: input.name },
        });
        return { ok: true as const, data: { id }, message: "Template saved." };
      });
    } catch (e) {
      const handled = templateError(e);
      if (handled) return handled;
      throw e;
    }
  });
  if (result.ok) {
    revalidatePath(`/w/${workspaceSlug}/templates`);
    if (!templateId) redirect(`/w/${workspaceSlug}/templates/${result.data.id}?saved=1`);
  }
  return result;
}

export async function archiveTemplateAction(
  workspaceSlug: string,
  templateId: string,
): Promise<ActionResult> {
  if (!isUuid(templateId)) return { ok: false, error: "Template not found." };
  const result = await withCapability(
    workspaceSlug,
    "templates.manage",
    async (ctx) =>
      withUserContext(ctx.user.userId, async (tx) => {
        await archiveTemplate(tx, { workspaceId: ctx.workspace.id }, templateId);
        await recordUserAudit(tx, ctx.user, {
          action: AUDIT_ACTIONS.templateArchived,
          entityType: "template",
          entityId: templateId,
          workspaceId: ctx.workspace.id,
        });
        return { ok: true as const, data: undefined };
      }),
    [TemplateError],
  );
  if (result.ok) redirect(`/w/${workspaceSlug}/templates`);
  return result;
}
