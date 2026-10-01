import "server-only";
import { withUserContext } from "@/db/client";
import { listAudiences } from "@/services/audience-service";
import { listMailboxes } from "@/services/mailbox-service";
import type { WorkspaceContext } from "../workspace";

/** Options for the campaign settings form. */
export async function campaignFormOptions(ctx: WorkspaceContext) {
  return withUserContext(ctx.user.userId, async (tx) => {
    const audiences = await listAudiences(tx, ctx.workspace.id);
    const mailboxes = await listMailboxes(tx, ctx.workspace.id);
    let timezones: string[] = [];
    try {
      timezones = Intl.supportedValuesOf("timeZone");
    } catch {
      timezones = [];
    }
    if (!timezones.includes(ctx.workspace.defaultTimezone))
      timezones.unshift(ctx.workspace.defaultTimezone);
    if (!timezones.includes("UTC")) timezones.push("UTC");
    return {
      audiences: audiences.map((a) => ({ id: a.id, name: a.name, members: a.counts.total })),
      mailboxes: mailboxes.map((m) => ({
        id: m.id,
        label: `${m.displayName} <${m.emailAddress}>`,
        usable: m.status === "CONNECTED" && m.enabled,
      })),
      timezones,
    };
  });
}
