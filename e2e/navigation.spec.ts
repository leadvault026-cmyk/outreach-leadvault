import { expect, test } from "@playwright/test";
import { authFile, DEMO_WS, trackConsoleErrors } from "./helpers";

test.use({ storageState: authFile("owner") });

const SECTIONS = [
  ["Dashboard", "dashboard"],
  ["Prospects", "prospects"],
  ["Audiences", "audiences"],
  ["Imports", "imports"],
  ["Campaigns", "campaigns"],
  ["Inbox", "inbox"],
  ["Templates", "templates"],
  ["Mailboxes", "mailboxes"],
  ["Suppression", "suppression"],
  ["Analytics", "analytics"],
  ["Settings", "settings"],
] as const;

test.describe("desktop navigation", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("every sidebar link opens its page without errors", async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await page.goto(`/w/${DEMO_WS}/dashboard`);
    const nav = page.getByRole("navigation", { name: "Primary" });
    for (const [label, segment] of SECTIONS) {
      const link =
        segment === "settings"
          ? page.getByRole("link", { name: "Settings", exact: true }).first()
          : nav.getByRole("link", { name: label, exact: true });
      await link.click();
      await expect(page).toHaveURL(new RegExp(`/w/${DEMO_WS}/${segment}$`));
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const active =
        segment === "settings" ? link : nav.getByRole("link", { name: label, exact: true });
      await expect(active).toHaveAttribute("aria-current", "page");
    }
    expect(errors).toEqual([]);
  });

  test("no internal link on any page is broken", async ({ page, request }) => {
    const toVisit = SECTIONS.map(([, s]) => `/w/${DEMO_WS}/${s}`).concat([
      `/w/${DEMO_WS}/profile`,
      `/w/${DEMO_WS}/settings/workspace`,
      `/w/${DEMO_WS}/settings/team`,
      `/w/${DEMO_WS}/settings/compliance`,
      `/w/${DEMO_WS}/settings/audit-log`,
    ]);
    const links = new Set<string>();
    for (const path of toVisit) {
      await page.goto(path);
      for (const href of await page.$$eval("a[href^='/']", (as) =>
        as.map((a) => a.getAttribute("href")!),
      )) {
        links.add(href.split("#")[0]!);
      }
    }
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    for (const href of links) {
      const res = await request.get(href, { headers: { cookie: cookieHeader } });
      expect(res.status(), href).toBeLessThan(400);
    }
    expect(links.size).toBeGreaterThan(15);
  });

  test("convenience routes resolve into the last-used workspace", async ({ page }) => {
    await page.goto(`/w/${DEMO_WS}/inbox`);
    await page.goto("/campaigns");
    await expect(page).toHaveURL(new RegExp(`/w/${DEMO_WS}/campaigns`));
    await page.goto("/unknown-module");
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  });

  test("search jumps to a section from the keyboard", async ({ page }) => {
    await page.goto(`/w/${DEMO_WS}/dashboard`);
    await page.keyboard.press("Control+k");
    const box = page.getByRole("combobox", { name: "Search sections" });
    await expect(box).toBeFocused();
    await box.fill("suppr");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/w/${DEMO_WS}/suppression`));
  });

  test("skip link moves focus to the main content", async ({ page }) => {
    await page.goto(`/w/${DEMO_WS}/dashboard`);
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
  });

  test("dashboard figures are labelled as demo data", async ({ page }) => {
    await page.goto(`/w/${DEMO_WS}/dashboard`);
    await expect(page.getByRole("note")).toContainText("fictional development data");
    await expect(page.getByText("Demo data", { exact: true }).first()).toBeVisible();
  });
});

test.describe("mobile navigation", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("the drawer opens, navigates and closes", async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await page.goto(`/w/${DEMO_WS}/dashboard`);
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeHidden();
    await page.getByRole("button", { name: "Open navigation" }).click();
    const drawer = page.getByRole("dialog", { name: "Navigation" });
    await expect(drawer).toBeVisible();
    await drawer.getByRole("link", { name: "Templates", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${DEMO_WS}/templates`));
    await expect(drawer).toBeHidden();
    // Escape closes it too.
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(drawer).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    expect(errors).toEqual([]);
  });
});
