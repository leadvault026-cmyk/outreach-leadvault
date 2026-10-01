import { existsSync, readFileSync } from "node:fs";
import type { Page } from "@playwright/test";

export const DEMO_WS = "northwind-demo";
export const OTHER_WS = "harbor-demo";

export const USERS = {
  owner: "owner@leadvault-demo.test",
  admin: "admin@leadvault-demo.test",
  operator: "operator@leadvault-demo.test",
  viewer: "viewer@leadvault-demo.test",
  isolated: "isolated@leadvault-demo.test",
} as const;
export type DemoUser = keyof typeof USERS;

export const authFile = (user: DemoUser) => `e2e/.auth/${user}.json`;

export function demoPassword(): string {
  if (process.env.SEED_DEMO_PASSWORD) return process.env.SEED_DEMO_PASSWORD;
  if (existsSync(".env.local")) {
    const line = readFileSync(".env.local", "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith("SEED_DEMO_PASSWORD="));
    if (line) return line.slice("SEED_DEMO_PASSWORD=".length);
  }
  throw new Error("SEED_DEMO_PASSWORD not found (set it in .env.local and run npm run db:seed)");
}

export async function signIn(page: Page, user: DemoUser, password = demoPassword()) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(USERS[user]);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Collects console errors and uncaught exceptions for a page. */
export function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}
