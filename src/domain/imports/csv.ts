import Papa from "papaparse";

/**
 * CSV intake (Phase 2 §E, §AI). Uploaded files are untrusted: nothing in them is executed,
 * sizes and shapes are bounded, and every problem is reported rather than silently dropped.
 */
export const CSV_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  maxRows: 10_000,
  maxColumns: 100,
  maxCellLength: 2_000,
  maxHeaderLength: 120,
} as const;

export type CsvParseError = {
  code:
    | "EMPTY_FILE"
    | "TOO_LARGE"
    | "NOT_CSV"
    | "INVALID_ENCODING"
    | "BINARY_CONTENT"
    | "NO_HEADER"
    | "TOO_MANY_COLUMNS"
    | "TOO_MANY_ROWS"
    | "NO_DATA_ROWS"
    | "UNPARSEABLE";
  message: string;
};

export type ParsedRow = {
  /** 1-based data-row number (the header is row 0). */
  rowNumber: number;
  cells: Record<string, string>;
  /** Shape problems found while parsing this row (e.g. too many/few fields). */
  problems: string[];
};

export type ParsedCsv = {
  headers: string[];
  rows: ParsedRow[];
  /** Headers that were renamed because they were blank or duplicated. */
  headerNotes: string[];
};

/** Strip path components and unsafe characters; always ends in .csv. */
export function sanitizeFileName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? "upload.csv")
    .normalize("NFKC")

    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  const safe = base.replace(/^\.+/, "") || "upload.csv";
  return /\.csv$/i.test(safe) ? safe : `${safe}.csv`;
}

export function looksLikeCsvName(name: string): boolean {
  return /\.csv$/i.test(name.trim());
}

/** Decode bytes as UTF-8 strictly (BOM stripped). Invalid sequences → INVALID_ENCODING. */
export function decodeCsvBytes(
  bytes: Uint8Array,
): { ok: true; text: string } | { ok: false; error: CsvParseError } {
  if (bytes.byteLength === 0)
    return { ok: false, error: { code: "EMPTY_FILE", message: "The file is empty." } };
  if (bytes.byteLength > CSV_LIMITS.maxBytes) {
    return {
      ok: false,
      error: {
        code: "TOO_LARGE",
        message: `The file is larger than ${CSV_LIMITS.maxBytes / 1024 / 1024} MB.`,
      },
    };
  }
  // NUL bytes indicate a binary file (or UTF-16, which is not supported).
  if (bytes.subarray(0, 8192).includes(0)) {
    return {
      ok: false,
      error: {
        code: "BINARY_CONTENT",
        message:
          "This does not look like a text CSV file. If it came from Excel, use “Save as → CSV UTF-8”.",
      },
    };
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
    return { ok: true, text };
  } catch {
    return {
      ok: false,
      error: {
        code: "INVALID_ENCODING",
        message: "The file is not valid UTF-8 text. Save it as “CSV UTF-8” and upload it again.",
      },
    };
  }
}

function cleanHeader(h: string): string {
  return h

    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CSV_LIMITS.maxHeaderLength);
}

export function parseCsvText(
  text: string,
): { ok: true; csv: ParsedCsv } | { ok: false; error: CsvParseError } {
  if (!text.trim())
    return { ok: false, error: { code: "EMPTY_FILE", message: "The file is empty." } };

  const result = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: "greedy",
    dynamicTyping: false, // values stay text; nothing is evaluated
  });
  const data = result.data;
  if (!data.length || !data[0]?.some((h) => h.trim())) {
    return {
      ok: false,
      error: { code: "NO_HEADER", message: "The first row must contain column headers." },
    };
  }

  const rawHeaders = data[0];
  if (rawHeaders.length > CSV_LIMITS.maxColumns) {
    return {
      ok: false,
      error: {
        code: "TOO_MANY_COLUMNS",
        message: `The file has more than ${CSV_LIMITS.maxColumns} columns.`,
      },
    };
  }
  const headerNotes: string[] = [];
  const seen = new Map<string, number>();
  const headers = rawHeaders.map((raw, i) => {
    let h = cleanHeader(raw);
    if (!h) {
      h = `Column ${i + 1}`;
      headerNotes.push(`Column ${i + 1} has no header; it was named “${h}”.`);
    }
    const n = (seen.get(h.toLowerCase()) ?? 0) + 1;
    seen.set(h.toLowerCase(), n);
    if (n > 1) {
      const renamed = `${h} (${n})`;
      headerNotes.push(
        `The header “${h}” appears more than once; the copy in column ${i + 1} was named “${renamed}”.`,
      );
      h = renamed;
    }
    return h;
  });

  const body = data.slice(1);
  if (body.length === 0) {
    return {
      ok: false,
      error: { code: "NO_DATA_ROWS", message: "The file has headers but no data rows." },
    };
  }
  if (body.length > CSV_LIMITS.maxRows) {
    return {
      ok: false,
      error: {
        code: "TOO_MANY_ROWS",
        message: `The file has ${body.length.toLocaleString()} rows. The limit is ${CSV_LIMITS.maxRows.toLocaleString()} per import — split the file and import each part.`,
      },
    };
  }

  // Papa reports per-row shape problems with a 0-based row index over `data`.
  const rowErrors = new Map<number, string[]>();
  for (const e of result.errors) {
    if (typeof e.row === "number") {
      rowErrors.set(e.row, [...(rowErrors.get(e.row) ?? []), e.message]);
    }
  }

  const rows: ParsedRow[] = body.map((fields, i) => {
    const problems = [...(rowErrors.get(i + 1) ?? [])];
    if (fields.length !== headers.length) {
      problems.push(`This row has ${fields.length} fields but the header has ${headers.length}.`);
    }
    const cells: Record<string, string> = {};
    headers.forEach((h, c) => {
      let v = fields[c] ?? "";
      if (v.length > CSV_LIMITS.maxCellLength) {
        v = v.slice(0, CSV_LIMITS.maxCellLength);
        problems.push(`“${h}” was longer than ${CSV_LIMITS.maxCellLength} characters and was cut.`);
      }
      cells[h] = v;
    });
    return { rowNumber: i + 1, cells, problems };
  });

  return { ok: true, csv: { headers, rows, headerNotes } };
}

/**
 * Neutralise spreadsheet formula injection in any CSV we generate for download: a cell beginning
 * with = + - @ tab or CR is prefixed with an apostrophe so spreadsheet apps treat it as text.
 */
export function escapeCsvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  return rows.map((r) => r.map(escapeCsvCell).join(",")).join("\r\n") + "\r\n";
}
