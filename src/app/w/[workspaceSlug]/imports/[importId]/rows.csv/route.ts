import { NextResponse, type NextRequest } from "next/server";
import { withUserContext } from "@/db/client";
import { reasonLabel } from "@/domain/eligibility";
import { toCsv, sanitizeFileName } from "@/domain/imports/csv";
import { isUuid } from "@/lib/ids";
import { resolveWorkspace } from "@/server/workspace";
import { getImport, listImportRows, rowCategory } from "@/services/import-service";
import { CATEGORY_LABELS, RESULT_ACTION_LABELS } from "@/components/imports/import-labels";

/**
 * Downloadable row results. Every cell passes through toCsv(), which neutralises spreadsheet
 * formula injection (cells starting with = + - @ are prefixed with an apostrophe).
 */
export async function GET(
  _req: NextRequest,
  ctx: RouteContext<"/w/[workspaceSlug]/imports/[importId]/rows.csv">,
) {
  const { workspaceSlug, importId } = await ctx.params;
  if (!isUuid(importId)) return new NextResponse("Not found", { status: 404 });
  const resolution = await resolveWorkspace(workspaceSlug);
  if (!resolution.ok) return new NextResponse("Not found", { status: 404 });
  const { user, workspace } = resolution.context;

  const data = await withUserContext(user.userId, async (tx) => {
    const imp = await getImport(tx, workspace.id, importId);
    if (!imp) return null;
    const out: string[][] = [
      [
        "Row",
        "Result",
        "Category",
        "Company",
        "Contact",
        "Email",
        "Country",
        "Issues",
        "Eligibility reasons",
        ...imp.options.headers,
      ],
    ];
    for (let page = 1; ; page++) {
      const { rows } = await listImportRows(tx, workspace.id, importId, {
        phase: "result",
        page,
        size: 1000,
      });
      for (const r of rows) {
        const m = (r.mapped ?? {}) as Record<string, unknown>;
        out.push([
          String(r.rowNumber),
          RESULT_ACTION_LABELS[r.outcome] ?? r.outcome,
          CATEGORY_LABELS[rowCategory(r.outcome, r.eligibility)]?.label ?? "",
          String(m.companyName ?? ""),
          String(m.contactName ?? ""),
          String(m.email ?? ""),
          String(m.countryCode ?? ""),
          r.issues.map((i) => i.message).join(" | "),
          r.eligibilityReasons.map(reasonLabel).join(" | "),
          ...imp.options.headers.map((h) => r.raw[h] ?? ""),
        ]);
      }
      if (rows.length < 1000) break;
    }
    return {
      name: sanitizeFileName(`${imp.sourceLabel ?? "import"}-results.csv`),
      csv: toCsv(out),
    };
  });
  if (!data) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(`﻿${data.csv}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${data.name.replace(/"/g, "")}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
