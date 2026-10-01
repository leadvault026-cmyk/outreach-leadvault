import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { authFile, DEMO_WS, horizontalOverflow, trackConsoleErrors } from "./helpers";

const WIDTHS = [320, 375, 768, 1024, 1280, 1440];
const PAGES = [
  "dashboard",
  "prospects",
  "audiences",
  "imports",
  "imports/new",
  "suppression",
  "campaigns",
  "settings",
  "settings/team",
  "settings/compliance",
  "profile",
];

test.describe("responsive shell", () => {
  test.use({ storageState: authFile("owner") });

  for (const width of WIDTHS) {
    test(`no horizontal overflow and usable navigation at ${width}px`, async ({ page }) => {
      const errors = trackConsoleErrors(page);
      await page.setViewportSize({ width, height: 900 });
      for (const p of PAGES) {
        await page.goto(`/w/${DEMO_WS}/${p}`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        expect(await horizontalOverflow(page), `${p} @ ${width}px`).toBeLessThanOrEqual(0);
      }
      const sidebar = page.getByRole("navigation", { name: "Primary" });
      const menuButton = page.getByRole("button", { name: "Open navigation" });
      if (width >= 1024) {
        await expect(sidebar).toBeVisible();
        await expect(menuButton).toBeHidden();
      } else {
        await expect(sidebar).toBeHidden();
        await expect(menuButton).toBeVisible();
      }
      expect(errors).toEqual([]);
    });
  }

  for (const width of [320, 768]) {
    test(`login page fits at ${width}px`, async ({ browser, baseURL }) => {
      const ctx = await browser.newContext({
        viewport: { width, height: 800 },
        baseURL,
        storageState: { cookies: [], origins: [] },
      });
      const page = await ctx.newPage();
      await page.goto("/login");
      await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      await ctx.close();
    });
  }
});

test.describe("accessibility (axe: WCAG 2.1 A/AA)", () => {
  const scan = (page: import("@playwright/test").Page) =>
    new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();

  const summarize = (violations: Awaited<ReturnType<typeof scan>>["violations"]) =>
    violations.map(
      (v) =>
        `${v.impact} ${v.id}: ${v.nodes
          .map((n) => n.target.join(" "))
          .slice(0, 3)
          .join(" | ")}`,
    );

  test("login and password reset pages", async ({ page }) => {
    for (const path of ["/login", "/forgot-password"]) {
      await page.goto(path);
      const result = await scan(page);
      expect(summarize(result.violations), path).toEqual([]);
    }
  });

  test.describe("signed in", () => {
    test.use({ storageState: authFile("owner") });
    for (const p of [
      "dashboard",
      "prospects",
      "prospects?eligibility=NEEDS_REVIEW",
      "audiences",
      "imports",
      "imports/new",
      "suppression",
      "settings",
      "settings/team",
      "settings/compliance",
      "profile",
    ]) {
      test(`/${p}`, async ({ page }) => {
        await page.goto(`/w/${DEMO_WS}/${p}`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        const result = await scan(page);
        expect(summarize(result.violations)).toEqual([]);
      });
    }

    test("detail pages (prospect, audience, import)", async ({ page }) => {
      for (const [list, pattern] of [
        ["prospects", /\/prospects\/[0-9a-f-]{36}$/],
        ["audiences", /\/audiences\/[0-9a-f-]{36}$/],
        ["imports", /\/imports\/[0-9a-f-]{36}$/],
      ] as const) {
        await page.goto(`/w/${DEMO_WS}/${list}`);
        const href = await page
          .locator(`main a[href^="/w/${DEMO_WS}/${list}/"]:not([href$="/new"])`)
          .first()
          .getAttribute("href");
        expect(href, list).toMatch(pattern);
        for (const width of [375, 1280]) {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(href!);
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
          expect(await horizontalOverflow(page), `${href} @ ${width}px`).toBeLessThanOrEqual(0);
          const result = await scan(page);
          expect(summarize(result.violations), `${href} @ ${width}px`).toEqual([]);
        }
      }
    });

    test("mobile drawer", async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`/w/${DEMO_WS}/dashboard`);
      await page.getByRole("button", { name: "Open navigation" }).click();
      await expect(page.getByRole("dialog", { name: "Navigation" })).toBeVisible();
      const result = await scan(page);
      expect(summarize(result.violations)).toEqual([]);
    });
  });
});
