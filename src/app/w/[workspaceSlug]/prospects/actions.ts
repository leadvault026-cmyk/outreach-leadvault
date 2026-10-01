"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { systemDb, withUserContext } from "@/db/client";
import { AUDIT_ACTIONS } from "@/domain/audit";
import { parseProspectFilters } from "@/domain/prospects/filters";
import { withCapability, type ActionResult } from "@/server/action-result";
import { recordUserAudit } from "@/server/audit";
import {
  addMembers,
  AudienceError,
  audienceInputSchema,
  createAudience,
  INCLUDE_POLICIES,
  type AddMembersResult,
} from "@/services/audience-service";
import { refreshExpiredEligibility } from "@/services/eligibility-service";
import { eligibilityBreakdown, selectProspectIds } from "@/services/prospect-query";

const MAX_SELECTION = 10_000;

const selectionSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("ids"), ids: z.array(z.uuid()).min(1).max(MAX_SELECTION) }),
  z.object({ mode: z.literal("filter"), query: z.string().max(2000) }),
]);
export type Selection = z.input<typeof selectionSchema>;

async function resolveIds(
  tx: Parameters<typeof selectProspectIds>[0],
  workspaceId: string,
  selection: z.output<typeof selectionSchema>,
) {
  if (selection.mode === "ids") return { ids: selection.ids, truncated: false };
  const params = Object.fromEntries(new URLSearchParams(selection.query));
  const has = new URLSearchParams(selection.query).getAll("has");
  return selectProspectIds(
    tx,
    workspaceId,
    parseProspectFilters({ ...params, has }),
    MAX_SELECTION,
  );
}

export type SelectionSummary = {
  count: number;
  truncated: boolean;
  breakdown: Record<"ELIGIBLE" | "NEEDS_REVIEW" | "INELIGIBLE" | "SUPPRESSED" | "UNKNOWN", number>;
};

/** How many prospects a selection contains, by eligibility — shown before anything is added. */
export async function previewSelectionAction(
  workspaceSlug: string,
  selection: Selection,
): Promise<ActionResult<SelectionSummary>> {
  const parsed = selectionSchema.safeParse(selection);
  if (!parsed.success) return { ok: false, error: "The selection could not be read." };
  return withCapability(workspaceSlug, "workspace.view", async (ctx) => {
    await refreshExpiredEligibility(systemDb(), ctx.workspace.id);
    return withUserContext(ctx.user.userId, async (tx) => {
      const { ids, truncated } = await resolveIds(tx, ctx.workspace.id, parsed.data);
      const breakdown = await eligibilityBreakdown(tx, ctx.workspace.id, ids);
      return { ok: true as const, data: { count: ids.length, truncated, breakdown } };
    });
  });
}

const addSchema = z.object({
  selection: selectionSchema,
  include: z.enum(INCLUDE_POLICIES),
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("existing"), audienceId: z.uuid() }),
    z.object({ kind: z.literal("new"), name: z.string(), description: z.string().optional() }),
  ]),
});

export async function addToAudienceAction(
  workspaceSlug: string,
  input: z.input<typeof addSchema>,
): Promise<ActionResult<AddMembersResult & { audienceId: string }>> {
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the audience details." };
  const { selection, include, target } = parsed.data;
  if (target.kind === "new") {
    const check = audienceInputSchema.safeParse(target);
    if (!check.success)
      return { ok: false, error: check.error.issues[0]?.message ?? "Check the audience name." };
  }
  const result = await withCapability(
    workspaceSlug,
    "audiences.manage",
    async (ctx) => {
      await refreshExpiredEligibility(systemDb(), ctx.workspace.id);
      return withUserContext(ctx.user.userId, async (tx) => {
        const actor = { workspaceId: ctx.workspace.id, userId: ctx.user.userId };
        let audienceId: string;
        if (target.kind === "new") {
          audienceId = await createAudience(tx, actor, {
            name: target.name,
            description: target.description,
          });
          await recordUserAudit(tx, ctx.user, {
            action: AUDIT_ACTIONS.audienceCreated,
            entityType: "audience",
            entityId: audienceId,
            workspaceId: ctx.workspace.id,
            metadata: { name: target.name },
          });
        } else {
          audienceId = target.audienceId;
        }
        const { ids } = await resolveIds(tx, ctx.workspace.id, selection);
        const res = await addMembers(tx, actor, audienceId, ids, include);
        await recordUserAudit(tx, ctx.user, {
          action: AUDIT_ACTIONS.audienceMembersAdded,
          entityType: "audience",
          entityId: audienceId,
          workspaceId: ctx.workspace.id,
          metadata: {
            selected: res.selected,
            added: res.added,
            already_members: res.alreadyMembers,
            excluded_review: res.excluded.NEEDS_REVIEW,
            excluded_ineligible: res.excluded.INELIGIBLE,
            excluded_suppressed: res.excluded.SUPPRESSED,
            include,
          },
        });
        return { ok: true as const, data: { ...res, audienceId } };
      });
    },
    [AudienceError],
  );
  if (result.ok) {
    revalidatePath(`/w/${workspaceSlug}/audiences`);
    revalidatePath(`/w/${workspaceSlug}/prospects`);
  }
  return result;
}
