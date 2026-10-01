/**
 * Runs the production standalone server exactly as the container does (Dockerfile), after
 * copying static assets next to it. Used by the E2E suite: `node scripts/start-standalone.mjs`.
 */
import { spawn } from "node:child_process";
import { cpSync, existsSync } from "node:fs";

const root = ".next/standalone";
if (!existsSync(`${root}/server.js`)) {
  console.error("No standalone build found. Run `npm run build` first.");
  process.exit(1);
}
cpSync(".next/static", `${root}/.next/static`, { recursive: true });
if (existsSync("public")) cpSync("public", `${root}/public`, { recursive: true });
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const child = spawn(process.execPath, ["server.js"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, PORT: process.env.PORT ?? "3100", HOSTNAME: "localhost" },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
