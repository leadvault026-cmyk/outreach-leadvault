import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ImportActionsBar } from "@/components/imports/import-actions-bar";
import { CATEGORY_LABELS, IMPORT_STATUS } from "@/components/imports/import-labels";
import { ImportRowsTable } from "@/components/imports/import-rows-table";
import { ImportSteps, type WizardStep } from "@/components/imports/import-steps";
import { MappingForm } from "@/components/imports/mapping-form";
import { SettingsForm } from "@/components/imports/settings-form";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { InlineAlert } from "@/components/states/inline-alert";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { withUserContext } from "@/db/client";
import { prospectImportRows, prospectImports } from "@/db/schema";
import { countryOptions } from "@/domain/geo";
import { suggestMapping } from "@/domain/imports/fields";
import { can } from "@/domain/permissions";
import { isUuid } from "@/lib/ids";
import { formatDateTime } from "@/lib/format";
import { getPageContext } from "@/server/page-context";
import {
  categoryCounts,
  getImport,
  listCustomFieldKeys,
  listImportRows,
  ROW_CATEGORIES,
  type RowCategory,
} from "@/services/import-service";
import { and, asc, desc, eq, ne } from "drizzle-orm";

export const metadata: Metadata = { title: "Import" };

const EDITABLE = ["uploaded", "parsed", "mapped", "ready"];
const FINISHED = ["completed", "completed_with_issues", "failed", "cancelled"];

export default async function ImportWizardPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/imports/[importId]">) {
  const ctx = await getPageContext(params);
  if (!ctx) return null;
  const { importId } = await params;
  if (!isUuid(importId)) notFound();
  const sp = await searchParams;
  const slug = ctx.workspace.slug;
  const canEdit = can(ctx.role, "prospects.manage");

  const data = await withUserContext(ctx.user.userId, async (tx) => {
    const imp = await getImport(tx, ctx.workspace.id, importId);
    if (!imp) return null;
    const previous = await tx
      .select({
        id: prospectImports.id,
        label: prospectImports.sourceLabel,
        createdAt: prospectImports.createdAt,
      })
      .from(prospectImports)
      .where(
        and(
          eq(prospectImports.workspaceId, ctx.workspace.id),
          eq(prospectImports.fileSha256, imp.fileSha256),
          ne(prospectImports.id, imp.id),
        ),
      )
      .orderBy(desc(prospectImports.createdAt))
      .limit(1);
    return { imp, previous: previous[0] ?? null };
  });
  if (!data) notFound();
  const { imp, previous } = data;

  // Which step to show.
  const requested = typeof sp.step === "string" ? (sp.step as WizardStep) : null;
  let step: WizardStep;
  if (FINISHED.includes(imp.status) || imp.status === "importing") step = "results";
  else if (!canEdit) step = imp.status === "ready" ? "preview" : "mapping";
  else if (imp.status === "uploaded" || imp.status === "parsed") step = "mapping";
  else if (imp.status === "mapped") step = requested === "mapping" ? "mapping" : "settings";
  else step = requested === "mapping" || requested === "settings" ? requested : "preview";

  const reachable: WizardStep[] =
    EDITABLE.includes(imp.status) && canEdit
      ? [
          "mapping",
          ...(imp.status !== "uploaded" ? (["settings"] as WizardStep[]) : []),
          ...(imp.status === "ready" ? (["preview"] as WizardStep[]) : []),
        ]
      : [];
  const base = `/w/${slug}/imports/${importId}`;
  const st = IMPORT_STATUS[imp.status] ?? { label: imp.status, tone: "neutral" as const };

  return (
    <>
      <PageHeader
        title={imp.sourceLabel ?? imp.fileName}
        badge={<StatusBadge status={imp.status} label={st.label} tone={st.tone} />}
        description={
          <>
            {imp.fileName} · {imp.rowCount?.toLocaleString() ?? 0} data rows · uploaded{" "}
            {formatDateTime(imp.createdAt, ctx.workspace.defaultTimezone)}
          </>
        }
        actions={
          <Button variant="outline" asChild>
            <Link href={`/w/${slug}/imports`}>All imports</Link>
          </Button>
        }
      />
      <ImportSteps current={step} reachable={reachable} hrefFor={(s) => `${base}?step=${s}`} />

      {previous && EDITABLE.includes(imp.status) ? (
        <InlineAlert tone="warning" title="This file was uploaded before" className="mb-4">
          The same file was uploaded as “{previous.label}” on{" "}
          {formatDateTime(previous.createdAt, ctx.workspace.defaultTimezone)}. Importing it again is
          safe: existing prospects are matched, not duplicated.
        </InlineAlert>
      ) : null}
      {imp.options.headerNotes.length && step === "mapping" ? (
        <InlineAlert tone="info" title="Header adjustments" className="mb-4">
          <ul className="list-disc pl-4">
            {imp.options.headerNotes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </InlineAlert>
      ) : null}

      {step === "mapping" ? <MappingStep ctx={ctx} imp={imp} canEdit={canEdit} /> : null}
      {step === "settings" ? <SettingsStep slug={slug} imp={imp} /> : null}
      {step === "preview" || step === "results" ? (
        <RowsStep
          ctx={ctx}
          imp={imp}
          phase={step === "preview" ? "preview" : "result"}
          sp={sp}
          canEdit={canEdit}
        />
      ) : null}
    </>
  );
}

type Imp = NonNullable<Awaited<ReturnType<typeof getImport>>>;
type Ctx = NonNullable<Awaited<ReturnType<typeof getPageContext>>>;

async function MappingStep({ ctx, imp, canEdit }: { ctx: Ctx; imp: Imp; canEdit: boolean }) {
  const { samples, customFields } = await withUserContext(ctx.user.userId, async (tx) => {
    const firstRows = await tx
      .select({ raw: prospectImportRows.raw })
      .from(prospectImportRows)
      .where(
        and(
          eq(prospectImportRows.workspaceId, ctx.workspace.id),
          eq(prospectImportRows.importId, imp.id),
        ),
      )
      .orderBy(asc(prospectImportRows.rowNumber))
      .limit(5);
    const samples: Record<string, string[]> = {};
    for (const h of imp.options.headers) {
      samples[h] = firstRows
        .map((r) => (r.raw[h] ?? "").trim())
        .filter(Boolean)
        .slice(0, 3)
        .map((v) => v.slice(0, 60));
    }
    return { samples, customFields: await listCustomFieldKeys(tx, ctx.workspace.id) };
  });
  const suggestion = suggestMapping(
    imp.options.headers,
    customFields.map((c) => c.key),
  );
  const initial = imp.mapping ?? suggestion.mapping;
  if (!canEdit) {
    return (
      <InlineAlert tone="info">
        This import is waiting for an Operator to map its columns.
      </InlineAlert>
    );
  }
  return (
    <MappingForm
      workspaceSlug={ctx.workspace.slug}
      importId={imp.id}
      headers={imp.options.headers}
      samples={samples}
      initial={initial}
      ambiguous={imp.mapping ? [] : suggestion.ambiguous}
      customFields={customFields}
      canCreateCustom={can(ctx.role, "customFields.manage")}
    />
  );
}

function SettingsStep({ slug, imp }: { slug: string; imp: Imp }) {
  const s = imp.options.settings;
  const targets = Object.values(imp.mapping ?? {});
  return (
    <SettingsForm
      workspaceSlug={slug}
      importId={imp.id}
      countries={countryOptions()}
      hasCountryColumn={targets.includes("country")}
      hasVerificationColumns={targets.includes("verification_status")}
      defaults={{
        sourceLabel: s?.sourceLabel ?? imp.sourceLabel ?? imp.fileName.replace(/\.csv$/i, ""),
        reference: s?.reference ?? "",
        defaultCountryCode: s?.defaultCountryCode ?? "",
        defaultBusinessType: s?.defaultBusinessType ?? "",
        verificationMode: s?.verificationMode ?? "trust",
        verificationSourceLabel: s?.verificationSourceLabel ?? "LeadVault research",
        onExisting: s?.onExisting ?? "update",
      }}
    />
  );
}

async function RowsStep({
  ctx,
  imp,
  phase,
  sp,
  canEdit,
}: {
  ctx: Ctx;
  imp: Imp;
  phase: "preview" | "result";
  sp: Record<string, string | string[] | undefined>;
  canEdit: boolean;
}) {
  const category = ROW_CATEGORIES.includes(sp.category as RowCategory)
    ? (sp.category as RowCategory)
    : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const size = 50;
  const { counts, list } = await withUserContext(ctx.user.userId, async (tx) => ({
    counts: await categoryCounts(tx, ctx.workspace.id, imp.id, phase),
    list: await listImportRows(tx, ctx.workspace.id, imp.id, { phase, category, page, size }),
  }));
  const slug = ctx.workspace.slug;
  const base = `/w/${slug}/imports/${imp.id}?step=${phase === "preview" ? "preview" : "results"}`;
  const summary = imp.options.summary;
  const stored = counts.ready + counts.review + counts.ineligible + counts.suppressed;
  const notImported = counts.duplicate + counts.invalid + counts.skipped + counts.error;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6">
      {phase === "result" && imp.status === "importing" ? (
        <InlineAlert tone="info" title="Import in progress">
          Reload this page in a moment to see the results.
        </InlineAlert>
      ) : null}
      {phase === "result" && imp.status === "failed" ? (
        <InlineAlert tone="danger" title="The import failed">
          No row was left undecided: every row below shows whether it was saved and why not.
          Reference: {imp.errorCode ?? "unknown"}.
        </InlineAlert>
      ) : null}
      {phase === "result" && imp.status === "cancelled" ? (
        <InlineAlert tone="info" title="This import was cancelled">
          No prospects were created or changed.
        </InlineAlert>
      ) : null}

      <section aria-labelledby="summary-heading" className="space-y-3">
        <h2 id="summary-heading" className="text-sm font-semibold">
          {phase === "preview" ? "What will happen" : "What happened"} — {total.toLocaleString()}{" "}
          rows
        </h2>
        {phase === "preview" && summary ? (
          <p className="text-sm text-muted-foreground">
            {summary.create} new · {summary.update} updated · {summary.unchanged} already up to date
            · {summary.duplicate} duplicates · {summary.invalid} invalid · {summary.skipped} blank
          </p>
        ) : null}
        {phase === "result" ? (
          <p className="tabular text-sm text-muted-foreground">
            {imp.createdCount} imported · {imp.updatedCount} updated · {imp.unchangedCount}{" "}
            unchanged · {imp.duplicateCount} duplicates · {imp.invalidCount} invalid ·{" "}
            {imp.skippedCount} skipped · {imp.errorCount} errors
          </p>
        ) : null}
        <nav aria-label="Filter rows by result" className="flex flex-wrap gap-2">
          <CategoryLink href={base} active={!category} label="All rows" count={total} />
          {ROW_CATEGORIES.filter((c) => counts[c] > 0).map((c) => (
            <CategoryLink
              key={c}
              href={`${base}&category=${c}`}
              active={category === c}
              label={CATEGORY_LABELS[c]!.label}
              count={counts[c]}
            />
          ))}
        </nav>
        {category ? (
          <p className="text-xs text-muted-foreground">{CATEGORY_LABELS[category]!.description}</p>
        ) : null}
      </section>

      {phase === "preview" && canEdit && imp.status === "ready" ? (
        <ImportActionsBar
          workspaceSlug={slug}
          importId={imp.id}
          willStore={stored}
          notImported={notImported}
        />
      ) : null}
      {phase === "result" &&
      ["completed", "completed_with_issues", "failed"].includes(imp.status) ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <a href={`/w/${slug}/imports/${imp.id}/rows.csv`} download>
              <Download /> Download row results (CSV)
            </a>
          </Button>
          <Button variant="outline" asChild>
            <Link href={`/w/${slug}/prospects?import=${imp.id}`}>View imported prospects</Link>
          </Button>
        </div>
      ) : null}

      {list.rows.length === 0 ? (
        <p className="rounded-lg border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          No rows in this view.
        </p>
      ) : (
        <ImportRowsTable rows={list.rows} phase={phase} workspaceSlug={slug} />
      )}
      <Pagination
        page={page}
        size={size}
        total={list.total}
        hrefFor={(p) => `${base}${category ? `&category=${category}` : ""}&page=${p}`}
      />
    </div>
  );
}

function CategoryLink({
  href,
  active,
  label,
  count,
}: {
  href: string;
  active: boolean;
  label: string;
  count: number;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${active ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}
    >
      {label}
      <span className="tabular opacity-80">{count.toLocaleString()}</span>
    </Link>
  );
}
