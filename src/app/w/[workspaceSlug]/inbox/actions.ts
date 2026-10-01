"use server";

import { revalidatePath } from "next/cache";
import { systemDb, withUserContext } from "@/db/client";
import { AUDIT_ACTIONS } from "@/domain/audit";
import { THREAD_CLASSIFICATIONS, type ThreadClassification } from "@/domain/enums";
import { isUuid } from "@/lib/ids";
import { withCapability, type ActionResult } from "@/server/action-result";
import { recordUserAudit } from "@/server/audit";
import { classifyThread, getThread } from "@/services/inbox-service";
import { processUnsubscribe } from "@/services/inbound-service";

export async function classifyThreadAction(
  workspaceSlug: string,
  threadId: string,
  classification: ThreadClassification,
): Promise<ActionResult<{ message: string }>> {
  if (!isUuid(threadId) || !THREAD_CLASSIFICATIONS.includes(classification))
    return { ok: false, error: "Conversation not found." };
  const result = await withCapability(workspaceSlug, "inbox.classify", async (ctx) => {
    const done = await withUserContext(ctx.user.userId, async (tx) => {
      const r = await classifyThread(
        tx,
        { workspaceId: ctx.workspace.id, userId: ctx.user.userId },
        threadId,
        classification,
      );
      if (r)
        await recordUserAudit(tx, ctx.user, {
          action: AUDIT_ACTIONS.replyClassified,
          entityType: "reply_thread",
          entityId: threadId,
          workspaceId: ctx.workspace.id,
          metadata: { classification },
        });
      return r;
    });
    if (!done) return { ok: false as const, error: "Conversation not found." };
    if (classification === "UNSUBSCRIBE") {
      // Treat it as an unsubscribe request (manual method): suppression + stop, same as the link.
      const thread = await withUserContext(ctx.user.userId, (tx) =>
        getThread(tx, ctx.workspace.id, threadId),
      );
      if (thread?.latestOutboundId)
        await processUnsubscribe(systemDb(), {
          messageId: thread.latestOutboundId,
          method: "manual",
          actorUserId: ctx.user.userId,
        });
      return {
        ok: true as const,
        data: { message: "Marked as unsubscribe: the address is suppressed in this workspace." },
      };
    }
    return { ok: true as const, data: { message: "Classification saved." } };
  });
  if (result.ok) {
    revalidatePath(`/w/${workspaceSlug}/inbox`);
    revalidatePath(`/w/${workspaceSlug}/inbox/${threadId}`);
  }
  return result;
}
