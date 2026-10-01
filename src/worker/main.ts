/**
 * LeadVault Outreach worker (architecture §13.2) — a separate process from the web app.
 *
 *   npm run worker            run continuously (Ctrl + C to stop)
 *   npm run worker -- --once  process everything that is due now, then exit
 *
 * Loops per tick: campaign lifecycle → dispatcher → executor (one in-flight send per mailbox) →
 * reconciliation → heartbeat. Safe to run as several replicas (SKIP LOCKED + leases + fencing).
 */
import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { AppDatabase } from "../db/rls";
import * as schema from "../db/schema";
import { workerHeartbeats } from "../db/schema";
import { FakeMailboxProvider } from "../providers/mailbox/fake";
import { sendConfig } from "../services/send-config";
import {
  dispatchDue,
  executeNext,
  reconcile,
  runLifecycle,
  type EngineContext,
  type ProviderResolver,
} from "../services/send-engine";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const TICK_MS = 5_000;
const once = process.argv.includes("--once");
const workerId = `${hostname()}-${process.pid}`;
const startedAt = new Date();

function log(message: string) {
  console.log(`${new Date().toISOString().slice(11, 19)}  ${message}`);
}

async function main() {
  const config = sendConfig();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example).");
  const client = postgres(url, { max: 3, onnotice: () => {} });
  const db = drizzle(client, { schema }) as unknown as AppDatabase;

  // One provider instance per process: the fake keeps its sent history for reconciliation.
  const fake = new FakeMailboxProvider();
  const resolveProvider: ProviderResolver = (mailbox) => {
    if (config.transport === "fake") return fake;
    // Live sending needs a real provider adapter, and none is registered in this build (no
    // provider has been purchased). Demo workspaces, whose jurisdiction policies are demo-only,
    // must never use a live transport even once one exists.
    if (mailbox.isDemoWorkspace) return null;
    return null; // future: getMailboxProvider(connection.provider)
  };
  const ctx: EngineContext = { db, config, workerId, resolveProvider };

  log(`Worker ${workerId} started.`);
  if (config.transport === "fake")
    log("Transport: FAKE — messages are recorded as sent, but NO email leaves this computer.");
  else log("Transport: LIVE requested — no live provider is connected, so nothing will be sent.");
  if (!config.sendingEnabled)
    log("SENDING_ENABLED=false — the kill switch is on; nothing will be sent.");
  if (!config.unsubscribeSecret || config.unsubscribeSecret.length < 32)
    log(
      "UNSUBSCRIBE_SIGNING_SECRET is missing — nothing will be dispatched (every email needs an opt-out link).",
    );

  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
    log("Stopping after the current step…");
  });
  process.on("SIGTERM", () => {
    stopping = true;
  });

  async function tick(): Promise<number> {
    let work = 0;
    const now = () => new Date();
    const life = await runLifecycle(db, now());
    if (life.started) log(`Started ${life.started} scheduled campaign(s).`);
    if (life.completed) log(`Completed ${life.completed} campaign(s): nothing left to send.`);
    work += life.started + life.completed;

    const d = await dispatchDue(ctx, now());
    if (d.queued) log(`Queued ${d.queued} email(s) to send.`);
    if (d.stopped) log(`Stopped ${d.stopped} recipient(s) at the final eligibility check.`);
    work += d.queued + d.stopped;

    for (let i = 0; i < 50 && !stopping; i++) {
      const r = await executeNext(ctx, now());
      if (r.kind === "idle") break;
      if (r.kind === "disabled") {
        log(`Not sending: ${r.reason}.`);
        break;
      }
      work++;
      if (r.kind === "sent") log(`Sent message ${r.messageId.slice(-8)} (fake transport).`);
      else if (r.kind === "skipped") log(`Skipped message ${r.messageId.slice(-8)}: ${r.reason}.`);
      else log(`Message ${r.messageId.slice(-8)}: ${r.kind}.`);
      if (r.kind === "skipped" && /window|limit/.test(r.reason)) break;
    }

    const rec = await reconcile(ctx, now());
    if (rec.expired || rec.confirmed || rec.review)
      log(
        `Reconciliation: ${rec.expired} expired lease(s), ${rec.confirmed} confirmed, ${rec.review} need review.`,
      );
    work += rec.expired + rec.confirmed;

    await db
      .insert(workerHeartbeats)
      .values({
        workerId,
        service: "worker",
        version: process.env.npm_package_version ?? "0",
        startedAt,
        lastBeatAt: new Date(),
        loops: { transport: config.transport, sendingEnabled: config.sendingEnabled },
      })
      .onConflictDoUpdate({
        target: workerHeartbeats.workerId,
        set: {
          lastBeatAt: new Date(),
          loops: { transport: config.transport, sendingEnabled: config.sendingEnabled },
        },
      });
    return work;
  }

  if (once) {
    // Process everything due now (mailbox spacing permitting), then exit.
    for (let i = 0; i < 100; i++) {
      const work = await tick();
      if (!work) break;
    }
    log("Done (--once).");
  } else {
    while (!stopping) {
      try {
        await tick();
      } catch (e) {
        log(`Tick failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      await new Promise((r) => setTimeout(r, TICK_MS));
    }
  }
  await client.end();
}

main().catch((e) => {
  console.error("Worker failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
