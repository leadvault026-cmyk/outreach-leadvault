"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { systemDb, withUserContext } from "@/db/client";
import { AUDIT_ACTIONS } from "@/domain/audit";
import { isUuid } from "@/lib/ids";
import { withCapability, type ActionResult } from "@/server/action-result";
import { recordSystemAudit, recordUserAudit } from "@/server/audit";
import {
  CampaignError,
  campaignSettingsSchema,
  createCampaign,
  launchCampaign,
  saveSteps,
  transitionCampaign,
  updateCampaignSettings,
  validateSteps,
  stepsInputSchema,
} from "@/services/campaign-service";
import { simulateInbound, type Simulation } from "@/services/inbound-service";
import { sendConfig, simulationAllowed } from "@/services/send-config";
import { resolveReviewMessage } from "@/services/send-engine";

type FieldErrors = Record<string, string>;

function readSettings(formData: FormData) {
  const n = (k: string) => String(formData.get(k) ?? "");
  return {
    name: n("name"),
    description: n("description"),
    audienceId: n("audienceId"),
    mailboxId: n("mailboxId"),
    timezone: n("timezone"),
    startMode: n("startMode") === "at" ? "at" : "launch",
    startDate: n("startDate") || undefined,
    startTime: n("startTime") || undefined,
    anyTime: formData.get("anyTime") === "on",
    sendDays: formData.getAll("sendDays").map(Number),
    windowStart: n("windowStart") || "08:00",
    windowEnd: n("windowEnd") || "17:00",
    dailyLimit: n("dailyLimit") ? Number(n("dailyLimit")) : null,
  };
}

function settingsErrors(input: unknown): FieldErrors | null {
  const parsed = campaignSettingsSchema.safeParse(input);
  if (parsed.success) return null;
  const out: FieldErrors = {};
  for (const i of parsed.error.issues) out[String(i.path[0])] ??= i.message;
  return out;
}

export async function saveCampaignSettingsAction(
  workspaceSlug: string,
  campaignId: string | null,
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  if (campaignId && !isUuid(campaignId)) return { ok: false, error: "Campaign not found." };
  const input = readSettings(formData);
  const fieldErrors = settingsErrors(input);
  if (fieldErrors) return { ok: false, error: "Check the highlighted fields.", fieldErrors };
  const result = await withCapability(
    workspaceSlug,
    "campaigns.manage",
    async (ctx) =>
      withUserContext(ctx.user.userId, async (tx) => {
        const actor = { workspaceId: ctx.workspace.id, userId: ctx.user.userId };
        const id = campaignId ?? (await createCampaign(tx, actor, input));
        if (campaignId) await updateCampaignSettings(tx, actor, campaignId, input);
        await recordUserAudit(tx, ctx.user, {
          action: campaignId ? AUDIT_ACTIONS.campaignUpdated : AUDIT_ACTIONS.campaignCreated,
          entityType: "campaign",
          entityId: id,
          workspaceId: ctx.workspace.id,
          metadata: { name: input.name },
        });
        return { ok: true as const, data: { id }, message: "Campaign saved." };
      }),
    [CampaignError],
  );
  if (result.ok) {
    revalidatePath(`/w/${workspaceSlug}/campaigns`);
    redirect(
      `/w/${workspaceSlug}/campaigns/${result.data.id}?tab=${campaignId ? "settings" : "sequence"}${campaignId ? "&saved=1" : ""}`,
    );
  }
  return result;
}

export type StepDraft = z.input<typeof stepsInputSchema>[number];

export async function saveStepsAction(
  workspaceSlug: string,
  campaignId: string,
  steps: StepDraft[],
): Promise<ActionResult<{ problems: ReturnType<typeof validateSteps> }>> {
  if (!isUuid(campaignId)) return { ok: false, error: "Campaign not found." };
  const parsed = stepsInputSchema.safeParse(steps);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the sequence." };
  const problems = validateSteps(parsed.data);
  if (problems.length) return { ok: true, data: { problems } };
  const result = await withCapability(
    workspaceSlug,
    "campaigns.manage",
    async (ctx) =>
      withUserContext(ctx.user.userId, async (tx) => {
        await saveSteps(tx, { workspaceId: ctx.workspace.id }, campaignId, parsed.data);
        await recordUserAudit(tx, ctx.user, {
          action: AUDIT_ACTIONS.campaignUpdated,
          entityType: "campaign",
          entityId: campaignId,
          workspaceId: ctx.workspace.id,
          metadata: { sequence_steps: parsed.data.length },
        });
        return { ok: true as const, data: { problems: [] }, message: "Sequence saved." };
      }),
    [CampaignError],
  );
  if (result.ok) revalidatePath(`/w/${workspaceSlug}/campaigns/${campaignId}`);
  return result;
}

export async function launchCampaignAction(
  workspaceSlug: string,
  campaignId: string,
): Promise<ActionResult<{ status: string; enrolled: number; excluded: number }>> {
  if (!isUuid(campaignId)) return { ok: false, error: "Campaign not found." };
  const secret = sendConfig().unsubscribeSecret;
  const result = await withCapability(
    workspaceSlug,
    "campaigns.manage",
    async (ctx) =>
      withUserContext(ctx.user.userId, async (tx) => {
        const res = await launchCampaign(
          tx,
          { workspaceId: ctx.workspace.id, userId: ctx.user.userId },
          campaignId,
          { unsubscribeConfigured: Boolean(secret && secret.length >= 32) },
        );
        await recordUserAudit(tx, ctx.user, {
          action: AUDIT_ACTIONS.campaignLaunched,
          entityType: "campaign",
          entityId: campaignId,
          workspaceId: ctx.workspace.id,
          metadata: {
            status: res.status,
            enrolled: res.enrolled,
            excluded: res.excluded,
            transport: sendConfig().transport,
          },
        });
        return { ok: true as const, data: res };
      }),
    [CampaignError],
  );
  if (result.ok) {
    revalidatePath(`/w/${workspaceSlug}/campaigns`);
    redirect(`/w/${workspaceSlug}/campaigns/${campaignId}?tab=overview&launched=1`);
  }
  return result;
}

const ACTION_AUDIT = {
  pause: AUDIT_ACTIONS.campaignPaused,
  resume: AUDIT_ACTIONS.campaignResumed,
  stop: AUDIT_ACTIONS.campaignStopped,
} as const;

export async function transitionCampaignAction(
  workspaceSlug: string,
  campaignId: string,
  action: "pause" | "resume" | "stop",
): Promise<ActionResult<{ status: string }>> {
  if (!isUuid(campaignId) || !(action in ACTION_AUDIT))
    return { ok: false, error: "Campaign not found." };
  const result = await withCapability(
    workspaceSlug,
    "campaigns.manage",
    async (ctx) =>
      withUserContext(ctx.user.userId, async (tx) => {
        const status = await transitionCampaign(
          tx,
          { workspaceId: ctx.workspace.id, userId: ctx.user.userId },
          campaignId,
          action,
        );
        await recordUserAudit(tx, ctx.user, {
          action: ACTION_AUDIT[action],
          entityType: "campaign",
          entityId: campaignId,
          workspaceId: ctx.workspace.id,
          metadata: { status },
        });
        return { ok: true as const, data: { status } };
      }),
    [CampaignError],
  );
  if (result.ok) revalidatePath(`/w/${workspaceSlug}/campaigns/${campaignId}`);
  return result;
}

const SIMULATIONS: readonly Simulation[] = [
  "reply",
  "out_of_office",
  "opt_out_reply",
  "hard_bounce",
  "soft_bounce",
];

/**
 * Fake-transport test events (no real mailbox exists). Builds a realistic inbound message and
 * runs it through the same ingestion pipeline a real mailbox sync would use.
 */
export async function simulateAction(
  workspaceSlug: string,
  campaignId: string,
  recipientId: string,
  kind: Simulation,
): Promise<ActionResult<{ message: string }>> {
  if (!isUuid(recipientId) || !isUuid(campaignId) || !SIMULATIONS.includes(kind))
    return { ok: false, error: "Recipient not found." };
  if (!simulationAllowed())
    return {
      ok: false,
      error: "Simulations are only available with the fake transport outside production.",
    };
  const result = await withCapability(workspaceSlug, "campaigns.manage", async (ctx) => {
    const res = await simulateInbound(systemDb(), ctx.workspace.id, recipientId, kind);
    if (!res)
      return { ok: false as const, error: "This recipient has not been sent an email yet." };
    await recordSystemAudit(ctx.user, {
      action: AUDIT_ACTIONS.simulationRun,
      entityType: "campaign_recipient",
      entityId: recipientId,
      workspaceId: ctx.workspace.id,
      metadata: { kind, transport: "fake" },
    });
    const message =
      kind === "hard_bounce"
        ? "Hard bounce recorded: the sequence stopped and the address is suppressed LeadVault-wide."
        : kind === "soft_bounce"
          ? "Soft bounce recorded (the sequence continues)."
          : kind === "out_of_office"
            ? "Out-of-office reply recorded (the sequence continues)."
            : res.stopped
              ? "Reply recorded: the remaining sequence for this prospect has stopped."
              : "Reply recorded.";
    return { ok: true as const, data: { message } };
  });
  if (result.ok) revalidatePath(`/w/${workspaceSlug}/campaigns/${campaignId}`);
  return result;
}

export async function resolveReviewAction(
  workspaceSlug: string,
  campaignId: string,
  messageId: string,
  action: "mark_sent" | "stop_recipient",
): Promise<ActionResult> {
  if (!isUuid(messageId) || !isUuid(campaignId)) return { ok: false, error: "Message not found." };
  const result = await withCapability(workspaceSlug, "sends.resolve", async (ctx) => {
    const done = await resolveReviewMessage(
      systemDb(),
      ctx.workspace.id,
      messageId,
      action,
      ctx.user.userId,
    );
    if (!done) return { ok: false as const, error: "This message no longer needs review." };
    await recordSystemAudit(ctx.user, {
      action: AUDIT_ACTIONS.messageReviewResolved,
      entityType: "message",
      entityId: messageId,
      workspaceId: ctx.workspace.id,
      metadata: { resolution: action },
    });
    return { ok: true as const, data: undefined };
  });
  if (result.ok) revalidatePath(`/w/${workspaceSlug}/campaigns/${campaignId}`);
  return result;
}
