import "server-only";
import { z } from "zod";

/**
 * Server environment, validated once on first use (and at boot via instrumentation.ts).
 * Never import this module from client components — `server-only` enforces that at build time.
 */
const serverEnvSchema = z.object({
  APP_ENV: z.enum(["local", "staging", "production"]),
  APP_BASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  /** Privileged Supabase key — server-only; used for admin operations (seed, future invites). */
  SUPABASE_SECRET_KEY: z.string().min(20).optional(),
  DATABASE_URL: z.url(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Report variable NAMES only — never values.
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid server environment configuration:\n  ${problems.join("\n  ")}`);
  }
  cached = parsed.data;
  return cached;
}
