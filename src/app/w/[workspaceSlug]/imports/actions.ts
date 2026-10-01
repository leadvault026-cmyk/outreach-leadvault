"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { userTxRunner, withUserContext } from "@/db/client";
import { AUDIT_ACTIONS } from "@/domain/audit";
import { CSV_LIMITS, looksLikeCsvName } from "@/domain/imports/csv";
import { customFieldKeyFromHeader, validateMapping } from "@/domain/imports/fields";
import { can } from "@/domain/permissions";
import { isUuid } from "@/lib/ids";
import { withCapability, type ActionResult } from "@/server/action-result";
import { recordUserAudit } from "@/server/audit";
import {
  cancelImport,
  commitImport,
  createImport,
  getImport,
  ImportError,
  importSettingsSchema,
  listCustomFieldKeys,
  saveMapping,
  validateImport,
} from "@/services/import-service";

const ALLOWED_TYPES = new Set([
  "",
  "text/csv",
  "application/csv",
  "text/plain",
  "application/vnd.ms-excel",
]);

export async function uploadImportAction(
  workspaceSlug: string,
  _prev: ActionResult<{ importId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ importId: string }>> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0)
    return { ok: false, error: "Choose a CSV file to upload." };
  if (!looksLikeCsvName(file.name) || !ALLOWED_TYPES.has(file.type)) {
    return {
      ok: false,
      error: "Only .csv files can be imported. In Excel, use “Save as → CSV UTF-8”.",
    };
  }
  if (file.size > CSV_LIMITS.maxBytes) {
    return { ok: false, error: `The file is larger than ${CSV_LIMITS.maxBytes / 1024 / 1024} MB.` };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());

  const result = await withCapability(workspaceSlug, "prospects.manage", async (ctx) => {
    const actor = { workspaceId: ctx.workspace.id, userId: ctx.user.userId };
    return withUserContext(ctx.user.userId, async (tx) => {
      const created = await createImport(tx, actor, { name: file.name, bytes });
      if (!created.ok) return { ok: false as const, error: created.error.message };
      await recordUserAudit(tx, ctx.user, {
        action: AUDIT_ACTIONS.importCreated,
        entityType: "prospect_import",
        entityId: created.importId,
        workspaceId: ctx.workspace.id,
        metadata: { rows: created.rowCount, previously_imported: Boolean(created.previous) },
      });
      return { ok: true as const, data: { importId: created.importId } };
    });
  });
  if (result.ok) redirect(`/w/${workspaceSlug}/imports/${result.data.importId}`);
  return result;
}

const mappingPayload = z.object({
  importId: z.uuid(),
  mapping: z.record(z.string().max(200), z.string().max(80)),
  /** Headers the operator chose to keep as NEW custom fields. */
  createCustom: z.array(z.string().max(200)).max(50),
});

export async function saveMappingAction(
  workspaceSlug: string,
  payload: z.input<typeof mappingPayload>,
): Promise<ActionResult> {
  const parsed = mappingPayload.safeParse(payload);
  if (!parsed.success)
    return { ok: false, error: "The mapping could not be read. Reload the page and try again." };
  const { importId, mapping, createCustom } = parsed.data;

  const result = await withCapability(
    workspaceSlug,
    "prospects.manage",
    async (ctx) => {
      const actor = { workspaceId: ctx.workspace.id, userId: ctx.user.userId };
      return withUserContext(ctx.user.userId, async (tx) => {
        const imp = await getImport(tx, ctx.workspace.id, importId);
        if (!imp) return { ok: false as const, error: "Import not found." };
        const existing = (await listCustomFieldKeys(tx, ctx.workspace.id)).map((c) => c.key);
        const newFields: Array<{ key: string; label: string }> = [];
        const finalMapping: Record<string, string> = { ...mapping };
        if (createCustom.length) {
          if (!can(ctx.role, "customFields.manage")) {
            return {
              ok: false as const,
              error: "Only workspace Admins can create new custom fields.",
            };
          }
          for (const header of createCustom) {
            const key = customFieldKeyFromHeader(header);
            if (!key || !imp.options.headers.includes(header)) {
              return {
                ok: false as const,
                error: `“${header}” cannot be used as a custom field name.`,
              };
            }
            finalMapping[header] = `custom:${key}`;
            if (!existing.includes(key) && !newFields.some((f) => f.key === key))
              newFields.push({ key, label: header });
          }
        }
        const checked = validateMapping(imp.options.headers, finalMapping, [
          ...existing,
          ...newFields.map((f) => f.key),
        ]);
        if (!checked.ok)
          return { ok: false as const, error: checked.problems.map((p) => p.message).join(" ") };
        await saveMapping(tx, actor, importId, checked.mapping, newFields);
        return { ok: true as const, data: undefined };
      });
    },
    [ImportError],
  );
  if (result.ok) redirect(`/w/${workspaceSlug}/imports/${importId}?step=settings`);
  return result;
}

export async function validateImportAction(
  workspaceSlug: string,
  importId: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  if (!isUuid(importId)) return { ok: false, error: "Import not found." };
  const raw = {
    sourceLabel: formData.get("sourceLabel"),
    reference: formData.get("reference") ?? "",
    defaultCountryCode: formData.get("defaultCountryCode") ?? "",
    defaultBusinessType: formData.get("defaultBusinessType") ?? "",
    verificationMode: formData.get("verificationMode"),
    verificationSourceLabel: formData.get("verificationSourceLabel") || "LeadVault research",
    onExisting: formData.get("onExisting"),
  };
  const parsed = importSettingsSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { ok: false, error: "Check the highlighted settings.", fieldErrors };
  }
  const result = await withCapability(
    workspaceSlug,
    "prospects.manage",
    async (ctx) =>
      withUserContext(ctx.user.userId, async (tx) => {
        await validateImport(
          tx,
          { workspaceId: ctx.workspace.id, userId: ctx.user.userId },
          importId,
          parsed.data,
        );
        return { ok: true as const, data: undefined };
      }),
    [ImportError],
  );
  if (result.ok) redirect(`/w/${workspaceSlug}/imports/${importId}?step=preview`);
  return result;
}

export async function commitImportAction(
  workspaceSlug: string,
  importId: string,
): Promise<ActionResult> {
  if (!isUuid(importId)) return { ok: false, error: "Import not found." };
  const result = await withCapability(
    workspaceSlug,
    "prospects.manage",
    async (ctx) => {
      const actor = { workspaceId: ctx.workspace.id, userId: ctx.user.userId };
      const outcome = await commitImport(userTxRunner(ctx.user.userId), actor, importId);
      await withUserContext(ctx.user.userId, (tx) =>
        recordUserAudit(tx, ctx.user, {
          action:
            outcome.status === "failed"
              ? AUDIT_ACTIONS.importFailed
              : AUDIT_ACTIONS.importCompleted,
          entityType: "prospect_import",
          entityId: importId,
          workspaceId: ctx.workspace.id,
          metadata: {
            status: outcome.status,
            created: outcome.summary.create,
            updated: outcome.summary.update,
            unchanged: outcome.summary.unchanged,
            invalid: outcome.summary.invalid,
            duplicates: outcome.summary.duplicate,
            error_rows: outcome.errorRows,
          },
        }),
      );
      return { ok: true as const, data: undefined };
    },
    [ImportError],
  );
  if (result.ok) redirect(`/w/${workspaceSlug}/imports/${importId}`);
  return result;
}

export async function cancelImportAction(
  workspaceSlug: string,
  importId: string,
): Promise<ActionResult> {
  if (!isUuid(importId)) return { ok: false, error: "Import not found." };
  const result = await withCapability(workspaceSlug, "prospects.manage", async (ctx) =>
    withUserContext(ctx.user.userId, async (tx) => {
      const done = await cancelImport(
        tx,
        { workspaceId: ctx.workspace.id, userId: ctx.user.userId },
        importId,
      );
      if (!done) return { ok: false as const, error: "This import can no longer be cancelled." };
      await recordUserAudit(tx, ctx.user, {
        action: AUDIT_ACTIONS.importCancelled,
        entityType: "prospect_import",
        entityId: importId,
        workspaceId: ctx.workspace.id,
      });
      return { ok: true as const, data: undefined };
    }),
  );
  if (result.ok) redirect(`/w/${workspaceSlug}/imports`);
  return result;
}
