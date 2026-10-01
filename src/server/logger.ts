import "server-only";

/**
 * Minimal structured JSON logger with redaction (architecture §27). pino arrives with the worker
 * in a later phase; this keeps the same shape (level, msg, fields) without a dependency.
 */
type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const REDACT = /pass(word)?|secret|token|api[-_]?key|credential|authori[sz]ation|cookie|session/i;

function threshold(): number {
  const level = (process.env.LOG_LEVEL ?? "info") as Level;
  return ORDER[level] ?? ORDER.info;
}

function scrub(value: unknown, depth = 0): unknown {
  if (value instanceof Error) {
    // Name + message only; stack traces stay out of structured logs shipped off-box.
    return { name: value.name, message: value.message };
  }
  if (depth > 3 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrub(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = REDACT.test(k) ? "[redacted]" : scrub(v, depth + 1);
  }
  return out;
}

function write(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (ORDER[level] < threshold()) return;
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    msg,
    ...(fields ? (scrub(fields) as Record<string, unknown>) : {}),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => write("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => write("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => write("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => write("error", msg, fields),
};
