import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against a PRODUCTION build of the app on the local stack
 * (Supabase CLI + seeded demo data). Prerequisites:
 *   npm run supabase:start && npm run db:migrate && npm run db:seed && npm run build
 * Override the target with E2E_BASE_URL (e.g. a dev server on :3000).
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3100";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  // One retry: the local Docker stack has been observed to stall database connections for
  // 10+ seconds (Supabase Auth log: "dial tcp …:5432: i/o timeout"). Tests that only pass on retry
  // are reported as "flaky" — never silently hidden.
  retries: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "node scripts/start-standalone.mjs",
        url: "http://localhost:3100/api/health",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
