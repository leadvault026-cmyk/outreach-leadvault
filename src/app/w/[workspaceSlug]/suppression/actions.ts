"use server";

import { revalidatePath } from "next/cache";
import { systemDb, withUserContext } from "@/db/client";
import { AUDIT_ACTIONS } from "@/domain/audit";
import { canManageGlobalSuppression } from "@/domain/permissions";
import { addSuppressionSchema, liftSuppressionSchema } from "@/domain/suppression";
import { PERMISSION_DENIED, withCapability, type ActionResult } from "@/server/action-result";
import { recordSystemAudit, recordUserAudit } from "@/server/audit";
import { getMyProfile } from "@/server/profile";
import {
  addGlobalSuppression,
  addWorkspaceSuppression,
  getSuppression,
  liftGlobalSuppression,
  liftWorkspaceSuppression,
  SuppressionError,
} from "@/services/suppression-service";

function fieldErrors(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>) {
  const out: Record<string, string> = {};
  for (const i of issues) out[String(i.path[0])] ??= i.message;
  return out;
}

export async function addSuppressionAction(
  workspaceSlug: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult<{ reevaluated: number }>> {
  const parsed = addSuppressionSchema.safeParse({
    valueType: formData.get("valueType"),
    value: formData.get("value"),
    scope: formData.get("scope") ?? "workspace",
    reason: formData.get("reason"),
    note: formData.get("note"),
  });
  if (!parsed.success)
    return {
      ok: false,
      error: "Check the highlighted fields.",
      fieldErrors: fieldErrors(parsed.error.issues),
    };
  const input = parsed.data;

  const result = await withCapability(
    workspaceSlug,
    "suppression.add",
    async (ctx) => {
      if (input.scope === "global") {
        // Platform administrators only; the write uses the privileged path because the database
        // refuses global suppression writes from any user session.
        if (!canManageGlobalSuppression(await getMyProfile()))
          return { ok: false as const, error: PERMISSION_DENIED };
        const res = await addGlobalSuppression(systemDb(), { userId: ctx.user.userId }, input);
        await recordSystemAudit(ctx.user, {
          action: AUDIT_ACTIONS.suppressionCreated,
          entityType: "suppression",
          entityId: res.id,
          metadata: {
            scope: "global",
            value_type: input.valueType,
            value: res.value,
            reason: input.reason,
            reevaluated: res.reevaluated,
          },
        });
        return {
          ok: true as const,
          data: { reevaluated: res.reevaluated },
          message: "Added to the LeadVault-wide suppression list.",
        };
      }
      return withUserContext(ctx.user.userId, async (tx) => {
        const res = await addWorkspaceSuppression(
          tx,
          { workspaceId: ctx.workspace.id, userId: ctx.user.userId },
          input,
        );
        await recordUserAudit(tx, ctx.user, {
          action: AUDIT_ACTIONS.suppressionCreated,
          entityType: "suppression",
          entityId: res.id,
          workspaceId: ctx.workspace.id,
          metadata: {
            scope: "workspace",
            value_type: input.valueType,
            value: res.value,
            reason: input.reason,
            reevaluated: res.reevaluated,
          },
        });
        return {
          ok: true as const,
          data: { reevaluated: res.reevaluated },
          message: "Suppression added.",
        };
      });
    },
    [SuppressionError],
  );
  if (result.ok) {
    revalidatePath(`/w/${workspaceSlug}/suppression`);
    revalidatePath(`/w/${workspaceSlug}/prospects`);
  }
  return result;
}

export async function liftSuppressionAction(
  workspaceSlug: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult<{ reevaluated: number }>> {
  const parsed = liftSuppressionSchema.safeParse({
    suppressionId: formData.get("suppressionId"),
    reason: formData.get("reason"),
  });
  if (!parsed.success)
    return {
      ok: false,
      error: "Check the highlighted fields.",
      fieldErrors: fieldErrors(parsed.error.issues),
    };
  const { suppressionId, reason } = parsed.data;

  const result = await withCapability(
    workspaceSlug,
    "suppression.lift",
    async (ctx) => {
      const target = await withUserContext(ctx.user.userId, (tx) =>
        getSuppression(tx, suppressionId),
      );
      if (!target) return { ok: false as const, error: "Suppression not found." };
      if (target.scope === "global") {
        if (!canManageGlobalSuppression(await getMyProfile())) {
          return {
            ok: false as const,
            error: "Only LeadVault platform administrators can lift a LeadVault-wide suppression.",
          };
        }
        const res = await liftGlobalSuppression(
          systemDb(),
          { userId: ctx.user.userId },
          suppressionId,
          reason,
        );
        await recordSystemAudit(ctx.user, {
          action: AUDIT_ACTIONS.suppressionLifted,
          entityType: "suppression",
          entityId: suppressionId,
          metadata: { scope: "global", value: res.value, reason, reevaluated: res.reevaluated },
        });
        return {
          ok: true as const,
          data: { reevaluated: res.reevaluated },
          message: "LeadVault-wide suppression lifted.",
        };
      }
      return withUserContext(ctx.user.userId, async (tx) => {
        const res = await liftWorkspaceSuppression(
          tx,
          { workspaceId: ctx.workspace.id, userId: ctx.user.userId },
          suppressionId,
          reason,
        );
        await recordUserAudit(tx, ctx.user, {
          action: AUDIT_ACTIONS.suppressionLifted,
          entityType: "suppression",
          entityId: suppressionId,
          workspaceId: ctx.workspace.id,
          metadata: { scope: "workspace", value: res.value, reason, reevaluated: res.reevaluated },
        });
        return {
          ok: true as const,
          data: { reevaluated: res.reevaluated },
          message: "Suppression lifted. The record stays in the history.",
        };
      });
    },
    [SuppressionError],
  );
  if (result.ok) {
    revalidatePath(`/w/${workspaceSlug}/suppression`);
    revalidatePath(`/w/${workspaceSlug}/prospects`);
  }
  return result;
}
