"use client";

import { FileSpreadsheet, UploadCloud, X } from "lucide-react";
import { useActionState, useId, useRef, useState } from "react";
import { uploadImportAction } from "@/app/w/[workspaceSlug]/imports/actions";
import { InlineAlert } from "@/components/states/inline-alert";
import { Button } from "@/components/ui/button";
import { CSV_LIMITS } from "@/domain/imports/csv";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/server/action-result";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** Client-side checks are a convenience; the server re-validates everything. */
function precheck(file: File): string | null {
  if (!/\.csv$/i.test(file.name))
    return "Only .csv files can be imported. In Excel, use “Save as → CSV UTF-8”.";
  if (file.size === 0) return "The file is empty.";
  if (file.size > CSV_LIMITS.maxBytes)
    return `The file is larger than ${CSV_LIMITS.maxBytes / 1024 / 1024} MB.`;
  return null;
}

export function UploadForm({ workspaceSlug }: { workspaceSlug: string }) {
  const [state, action, pending] = useActionState<
    ActionResult<{ importId: string }> | null,
    FormData
  >(uploadImportAction.bind(null, workspaceSlug), null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const hintId = useId();

  const choose = (f: File | null) => {
    setRows(null);
    setFile(f);
    setError(f ? precheck(f) : null);
    if (f && !precheck(f)) {
      f.text()
        .then((t) => {
          // Approximate count for feedback only (the server parses properly).
          const lines = t.split(/\r?\n/).filter((l) => l.trim()).length;
          setRows(Math.max(0, lines - 1));
        })
        .catch(() => setRows(null));
    }
    if (inputRef.current && f) {
      const dt = new DataTransfer();
      dt.items.add(f);
      inputRef.current.files = dt.files;
    }
  };

  return (
    <form action={action} className="max-w-2xl space-y-4">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          choose(e.dataTransfer.files?.[0] ?? null);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed bg-card px-6 py-10 text-center transition-colors focus-within:outline-2 focus-within:outline-ring",
          dragging ? "border-primary bg-muted" : "hover:bg-muted/50",
        )}
      >
        <UploadCloud aria-hidden className="mb-3 size-8 text-muted-foreground" />
        <span className="text-sm font-medium">Drag a CSV file here, or click to choose a file</span>
        <span id={hintId} className="mt-1 text-xs text-muted-foreground">
          CSV (UTF-8) only · up to {CSV_LIMITS.maxBytes / 1024 / 1024} MB and{" "}
          {CSV_LIMITS.maxRows.toLocaleString()} rows · the first row must contain column headers
        </span>
        <input
          ref={inputRef}
          type="file"
          name="file"
          accept=".csv,text/csv"
          aria-describedby={hintId}
          className="sr-only"
          onChange={(e) => choose(e.target.files?.[0] ?? null)}
        />
      </label>

      {file ? (
        <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
          <FileSpreadsheet aria-hidden className="size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{file.name}</p>
            <p className="text-xs text-muted-foreground">
              {formatBytes(file.size)}
              {rows !== null ? ` · about ${rows.toLocaleString()} data rows detected` : ""}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Remove file"
            onClick={() => {
              setFile(null);
              setError(null);
              if (inputRef.current) inputRef.current.value = "";
            }}
          >
            <X />
          </Button>
        </div>
      ) : null}

      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      {state && !state.ok ? <InlineAlert tone="danger">{state.error}</InlineAlert> : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!file || Boolean(error) || pending}>
          {pending ? "Uploading and reading the file…" : "Upload and continue"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Nothing is imported until you confirm on the preview step.
        </p>
      </div>
    </form>
  );
}
