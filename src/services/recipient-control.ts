import { sql } from "drizzle-orm";
import type { AppDatabase } from "@/db/rls";

/**
 * Stop rules (architecture §10): moves live campaign recipients (QUEUED / SCHEDULED / SENDING)
 * to a terminal state and cancels their not-yet-sent messages. State-guarded, so repeating it
 * (duplicate events, two workers) is harmless. Messages already handed to the provider
 * (SENDING / RECONCILIATION_REQUIRED / OPERATOR_REVIEW) are never cancelled — the email may exist.
 */
export type HaltStatus =
  "REPLIED" | "BOUNCED" | "UNSUBSCRIBED" | "SUPPRESSED" | "STOPPED" | "CANCELLED" | "FAILED";

export type HaltFilter =
  | { kind: "recipients"; ids: readonly string[] }
  | { kind: "campaign"; workspaceId: string; campaignId: string }
  /** workspaceId null = every workspace (global suppression). */
  | { kind: "email"; workspaceId: string | null; email: string }
  | { kind: "domain"; workspaceId: string | null; domain: string };

export async function haltRecipients(
  db: AppDatabase,
  filter: HaltFilter,
  status: HaltStatus,
  reason: string,
  now = new Date(),
  by: string | null = null,
  /**
   * Cancel their PENDING messages too. `messages` is engine-written (read-only for users), so
   * callers inside a user's RLS transaction pass false; the worker's sweep (runLifecycle) and the
   * executor's recipient check then cancel those messages.
   */
  opts: { cancelMessages?: boolean } = {},
): Promise<string[]> {
  let where;
  switch (filter.kind) {
    case "recipients":
      if (!filter.ids.length) return [];
      where = sql`id in (${sql.join(
        filter.ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`;
      break;
    case "campaign":
      where = sql`workspace_id = ${filter.workspaceId} and campaign_id = ${filter.campaignId}`;
      break;
    case "email":
      where = filter.workspaceId
        ? sql`workspace_id = ${filter.workspaceId} and email_normalized = ${filter.email}`
        : sql`email_normalized = ${filter.email}`;
      break;
    case "domain":
      where = filter.workspaceId
        ? sql`workspace_id = ${filter.workspaceId} and split_part(email_normalized, '@', 2) = ${filter.domain}`
        : sql`split_part(email_normalized, '@', 2) = ${filter.domain}`;
      break;
  }
  const halted = await db.execute(sql`
    update app.campaign_recipients
       set status = ${status}, stop_reason = ${reason}, stopped_at = ${now.toISOString()}::timestamptz,
           stopped_by = ${by}, next_step = null, next_send_at = null, updated_at = now()
     where ${where} and status in ('QUEUED', 'SCHEDULED', 'SENDING')
     returning id`);
  const ids = rows<{ id: string }>(halted).map((r) => r.id);
  if (ids.length && opts.cancelMessages !== false) {
    await db.execute(sql`
      update app.messages set status = 'CANCELLED', updated_at = now()
       where campaign_recipient_id in (${sql.join(
         ids.map((id) => sql`${id}::uuid`),
         sql`, `,
       )})
         and status in ('PENDING', 'RETRY_WAIT')`);
  }
  return ids;
}

/** postgres.js returns rows as an array; PGlite returns { rows }. Normalize both. */
export function rows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const r = result as { rows?: T[] };
  return r.rows ?? [];
}
