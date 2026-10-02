import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppDatabase } from "@/db/rls";
import { mailboxes, providerConnections } from "@/db/schema";

/**
 * Mailboxes (architecture §4.7). Connecting a new mailbox needs a purchased provider and stored
 * credentials, which this build does not have, so the UI manages existing mailboxes only:
 * limits, spacing and enable/disable. Credentials are never selected (column not granted).
 */
export async function listMailboxes(db: AppDatabase, workspaceId: string) {
  return db
    .select({
      id: mailboxes.id,
      emailAddress: mailboxes.emailAddress,
      displayName: mailboxes.displayName,
      status: mailboxes.status,
      statusReason: mailboxes.statusReason,
      enabled: mailboxes.enabled,
      dailySendLimit: mailboxes.dailySendLimit,
      minSecondsBetweenSends: mailboxes.minSecondsBetweenSends,
      timezone: mailboxes.timezone,
      warmupStatus: mailboxes.warmupStatus,
      infraVendor: mailboxes.infraVendor,
      lastSendAt: mailboxes.lastSendAt,
      provider: providerConnections.provider,
      sentToday: sql<number>`(select count(*)::int from app.messages m
        where m.mailbox_id = "app"."mailboxes"."id" and m.status = 'SENT'
          and (m.sent_at at time zone "app"."mailboxes"."timezone")::date = (now() at time zone "app"."mailboxes"."timezone")::date)`,
      sentTotal: sql<number>`(select count(*)::int from app.messages m where m.mailbox_id = "app"."mailboxes"."id" and m.status = 'SENT')`,
      hardBounces: sql<number>`(select count(*)::int from app.messages m where m.mailbox_id = "app"."mailboxes"."id" and m.bounce_type = 'hard')`,
    })
    .from(mailboxes)
    .leftJoin(providerConnections, eq(providerConnections.id, mailboxes.providerConnectionId))
    .where(eq(mailboxes.workspaceId, workspaceId))
    .orderBy(asc(mailboxes.emailAddress));
}

export const mailboxSettingsSchema = z.object({
  dailySendLimit: z.coerce.number().int().min(1, "At least 1.").max(2000, "At most 2,000."),
  minSecondsBetweenSends: z.coerce.number().int().min(0).max(3600, "At most one hour."),
  enabled: z.boolean(),
});

export async function updateMailboxSettings(
  tx: AppDatabase,
  actor: { workspaceId: string },
  mailboxId: string,
  input: unknown,
): Promise<boolean> {
  const v = mailboxSettingsSchema.parse(input);
  const rows = await tx
    .update(mailboxes)
    // Re-evaluate immediately: a mailbox parked until tomorrow by its old daily limit (or while
    // disabled) becomes available again. The executor still enforces the cap atomically per send.
    .set({
      ...v,
      nextAvailableAt: sql`least(${mailboxes.nextAvailableAt}, now())`,
      updatedAt: new Date(),
    })
    .where(and(eq(mailboxes.workspaceId, actor.workspaceId), eq(mailboxes.id, mailboxId)))
    .returning({ id: mailboxes.id });
  return rows.length > 0;
}
