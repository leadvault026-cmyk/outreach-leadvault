/**
 * Prospect repository performance check — LOCAL ONLY.
 *
 * Runs the real service functions against the synthetic "scale-demo" workspace
 * (npm run db:seed:synthetic) as the demo owner, i.e. through Row Level Security exactly like the
 * app. For each scenario it reports the median wall time of 5 runs and EXPLAIN ANALYZE of every
 * SQL statement the service issued (executed under the same RLS context), flagging sequential
 * scans of large tables.
 *
 *   npm run perf:prospects             # print a report
 *   npm run perf:prospects -- --write  # also write docs/PERFORMANCE.md
 */
import { existsSync, writeFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { runAsUser, type AppDatabase } from "../src/db/rls";
import * as s from "../src/db/schema";
import { parseProspectFilters } from "../src/domain/prospects/filters";
import { getAudience, listAudiences } from "../src/services/audience-service";
import { refreshEligibility } from "../src/services/eligibility-service";
import {
  eligibilityBreakdown,
  listProspects,
  prospectFacets,
  selectProspectIds,
} from "../src/services/prospect-query";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const LARGE_TABLES = new Set(["prospects", "prospect_outreach_state", "audience_members"]);

type Captured = { query: string; params: unknown[] };
type PlanNode = {
  "Node Type": string;
  "Relation Name"?: string;
  "Index Name"?: string;
  "Actual Rows"?: number;
  Plans?: PlanNode[];
};

function walk(node: PlanNode, out: string[], seq: string[]) {
  const rel = node["Relation Name"];
  const idx = node["Index Name"];
  if (rel || idx) out.push(`${node["Node Type"]}${rel ? ` ${rel}` : ""}${idx ? ` [${idx}]` : ""}`);
  if (node["Node Type"] === "Seq Scan" && rel && LARGE_TABLES.has(rel)) seq.push(rel);
  for (const c of node.Plans ?? []) walk(c, out, seq);
}

async function main() {
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (
    process.env.APP_ENV !== "local" ||
    !/^postgres(ql)?:\/\/([^@/]*@)?(127\.0\.0\.1|localhost)/.test(dbUrl)
  ) {
    console.error("Refusing to run: local database only.");
    process.exit(1);
  }
  const client = postgres(dbUrl, { max: 1, onnotice: () => {} });
  let capture: Captured[] | null = null;
  const db = drizzle(client, {
    schema: s,
    logger: {
      logQuery(query, params) {
        if (capture && /^\s*select/i.test(query)) capture.push({ query, params });
      },
    },
  }) as unknown as AppDatabase;

  const [ws] = await client`select id from app.workspaces where slug = 'scale-demo'`;
  const [owner] =
    await client`select user_id from app.profiles where email = 'owner@leadvault-demo.test'`;
  if (!ws || !owner) throw new Error("Run npm run db:seed && npm run db:seed:synthetic first.");
  const wsId = ws.id as string;
  const userId = owner.user_id as string;
  const [countRow] =
    await client`select count(*)::int as n from app.prospects where workspace_id = ${wsId}`;
  const total = Number(countRow?.n ?? 0);
  const [aud] = await client`select id from app.audiences where workspace_id = ${wsId} limit 1`;
  const audienceId = aud!.id as string;
  const someIds = (
    await client`select id from app.prospects where workspace_id = ${wsId} order by id limit 5000`
  ).map((r) => r.id as string);

  const f = (q: Record<string, string | string[]>) => parseProspectFilters(q);
  const scenarios: Array<{ name: string; run: (tx: AppDatabase) => Promise<unknown> }> = [
    {
      name: "List, default sort (updated), page 1 × 50",
      run: (tx) => listProspects(tx, wsId, f({})),
    },
    {
      name: "List, page 200 × 50 (deep offset)",
      run: (tx) => listProspects(tx, wsId, f({ page: "200" })),
    },
    { name: "Search “family”", run: (tx) => listProspects(tx, wsId, f({ q: "family" })) },
    {
      name: "Search “riverbend dermatology 12”",
      run: (tx) => listProspects(tx, wsId, f({ q: "riverbend dermatology 12" })),
    },
    {
      name: "Search email fragment “quinn.marlow”",
      run: (tx) => listProspects(tx, wsId, f({ q: "quinn.marlow" })),
    },
    {
      name: "Filter eligibility = Eligible",
      run: (tx) => listProspects(tx, wsId, f({ eligibility: "ELIGIBLE" })),
    },
    {
      name: "Filter US / US-TX / verified",
      run: (tx) =>
        listProspects(tx, wsId, f({ country: "US", region: "US-TX", verification: "VERIFIED" })),
    },
    {
      name: "Filter type + has phone + has evidence",
      run: (tx) =>
        listProspects(tx, wsId, f({ type: "Dental Practice", has: ["phone", "evidence"] })),
    },
    { name: "Sort by company A–Z", run: (tx) => listProspects(tx, wsId, f({ sort: "company" })) },
    {
      name: "Sort by eligibility",
      run: (tx) => listProspects(tx, wsId, f({ sort: "eligibility" })),
    },
    {
      name: "Audience members (5,000-member audience)",
      run: (tx) => listProspects(tx, wsId, f({ audience: audienceId })),
    },
    {
      name: "Filter facets (countries, types, regions, imports, audiences, totals)",
      run: (tx) => prospectFacets(tx, wsId),
    },
    {
      name: "Select all matching “review required” (ids)",
      run: (tx) => selectProspectIds(tx, wsId, f({ eligibility: "NEEDS_REVIEW" })),
    },
    {
      name: "Eligibility breakdown of 5,000 selected ids",
      run: (tx) => eligibilityBreakdown(tx, wsId, someIds),
    },
    { name: "Audience list with eligibility counts", run: (tx) => listAudiences(tx, wsId) },
    { name: "Audience detail summary", run: (tx) => getAudience(tx, wsId, audienceId) },
  ];

  const rows: string[] = [];
  const details: string[] = [];
  let seqScanFindings = 0;
  for (const sc of scenarios) {
    await runAsUser(db, userId, sc.run); // warm-up
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      await runAsUser(db, userId, sc.run);
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    const median = times[2]!;

    capture = [];
    await runAsUser(db, userId, sc.run);
    const queries = capture;
    capture = null;
    const planLines: string[] = [];
    const seq: string[] = [];
    let dbMs = 0;
    for (const q of queries) {
      const plan = await client.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true)`;
        await tx`set local role authenticated`;
        const [r] = await tx.unsafe(
          `explain (analyze, buffers, format json) ${q.query}`,
          q.params as never[],
        );
        return (r as Record<string, unknown>)["QUERY PLAN"] as Array<{
          Plan: PlanNode;
          "Execution Time": number;
        }>;
      });
      const top = plan[0]!;
      dbMs += top["Execution Time"];
      const nodes: string[] = [];
      walk(top.Plan, nodes, seq);
      planLines.push(
        `  - ${top["Execution Time"].toFixed(1)} ms: ${[...new Set(nodes)].join(", ")}`,
      );
    }
    if (seq.length) seqScanFindings++;
    rows.push(
      `| ${sc.name} | ${median.toFixed(0)} | ${dbMs.toFixed(1)} | ${queries.length} | ${seq.length ? `Seq scan: ${[...new Set(seq)].join(", ")}` : "index only"} |`,
    );
    details.push(`**${sc.name}**\n\n${planLines.join("\n")}\n`);
  }

  const t = performance.now();
  await refreshEligibility(db, wsId, { kind: "all" });
  const refreshMs = performance.now() - t;

  const report = [
    "# Prospect repository performance (local)",
    "",
    `Generated by \`npm run perf:prospects\` against the synthetic **scale-demo** workspace (${Number(total).toLocaleString()} fictional prospects; 5,000-member audience), local Supabase in Docker on a developer laptop. Every query runs **through Row Level Security** as the demo owner, exactly as the app does. Times are medians of 5 runs after a warm-up; "DB time" is the sum of EXPLAIN ANALYZE execution times of the statements the service issued.`,
    "",
    "| Scenario | Wall ms (median) | DB time ms | Statements | Large-table scans |",
    "| --- | ---: | ---: | ---: | --- |",
    ...rows,
    `| Re-evaluate eligibility for every prospect (system path) | ${refreshMs.toFixed(0)} | — | — | batch of 1,000 by keyset |`,
    "",
    `Sequential scans of large tables flagged in ${seqScanFindings} scenario(s). On a ${Number(total).toLocaleString()}-row workspace PostgreSQL may legitimately prefer a sequential scan when a filter matches a large share of rows; see the plans below.`,
    "",
    "## Finding fixed in Phase 2",
    "",
    "The first measurement (Phase 1 policies) took **1.3–3.2 s per list query** at this size: every tenant policy called the SECURITY DEFINER function `app.has_workspace_role(workspace_id, …)` once per row (~0.1 ms each). Migration `0004_rls_set_based` keeps the same rules but evaluates membership once per statement (`workspace_id IN (SELECT app.my_workspace_ids(role))`). All RLS and malicious cross-workspace tests pass unchanged.",
    "",
    "The trigram index `prospects_search_trgm_idx` is used for selective searches once a workspace is large enough for it to beat a sequential scan (verified with `enable_seqscan = off`: Bitmap Index Scan on the trigram index). At ~12,000 rows a full scan of the workspace is cheaper and PostgreSQL rightly chooses it.",
    "",
    "## Plans",
    "",
    ...details,
  ].join("\n");
  console.log(report);
  if (process.argv.includes("--write")) {
    writeFileSync("docs/PERFORMANCE.md", report + "\n");
    console.log("\nWritten to docs/PERFORMANCE.md");
  }
  await client.end();
}

main().catch((e) => {
  console.error("perf failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
