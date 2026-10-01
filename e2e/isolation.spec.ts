import { expect, test } from "@playwright/test";
import { authFile, DEMO_WS, OTHER_WS } from "./helpers";

test.describe("workspace isolation in the UI", () => {
  test.use({ storageState: authFile("isolated") });

  test("a member of workspace B cannot open workspace A", async ({ page }) => {
    await page.goto(`/w/${DEMO_WS}/dashboard`);
    await expect(page.getByRole("heading", { name: "Workspace not available" })).toBeVisible();
    // Nothing from workspace A leaks onto the page.
    await expect(page.getByText("Northwind")).toHaveCount(0);
    await expect(page.getByText("Texas Medical Providers")).toHaveCount(0);
  });

  test("workspace A's sub-pages are equally unavailable", async ({ page }) => {
    for (const path of ["settings/team", "settings/audit-log", "profile", "prospects"]) {
      await page.goto(`/w/${DEMO_WS}/${path}`);
      await expect(
        page.getByRole("heading", { name: "Workspace not available" }),
        path,
      ).toBeVisible();
      await expect(page.getByText("Morgan Ellis"), path).toHaveCount(0);
    }
  });

  test("a non-existent workspace looks identical (existence is not revealed)", async ({ page }) => {
    await page.goto("/w/does-not-exist/dashboard");
    await expect(page.getByRole("heading", { name: "Workspace not available" })).toBeVisible();
  });

  test("the user lands in, and can only switch between, their own workspaces", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(new RegExp(`/w/${OTHER_WS}/dashboard`));
    await page
      .getByRole("button", { name: /Current workspace/ })
      .first()
      .click();
    const items = page.getByRole("menuitem");
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText("Harbor Dental Group");
  });
});

test.describe("role-based pages", () => {
  test.describe("viewer", () => {
    test.use({ storageState: authFile("viewer") });
    test("cannot open the audit log", async ({ page }) => {
      await page.goto(`/w/${DEMO_WS}/settings/audit-log`);
      await expect(
        page.getByRole("heading", { name: "You don't have access to this page" }),
      ).toBeVisible();
    });
  });

  test.describe("admin", () => {
    test.use({ storageState: authFile("admin") });
    test("can open the audit log", async ({ page }) => {
      await page.goto(`/w/${DEMO_WS}/settings/audit-log`);
      await expect(page.getByRole("heading", { level: 1, name: "Audit log" })).toBeVisible();
    });
  });
});

test.describe("security audit trail", () => {
  test("a denied workspace access attempt is recorded", async ({ browser }) => {
    const isolated = await browser.newContext({ storageState: authFile("isolated") });
    const page = await isolated.newPage();
    await page.goto(`/w/${DEMO_WS}/dashboard`);
    await expect(page.getByRole("heading", { name: "Workspace not available" })).toBeVisible();
    await isolated.close();
    // The event is workspace-less and attributed to the user; verified at the DB layer in
    // tests/db (append-only, attributed). Here we confirm the UI flow completes without error.
  });
});
