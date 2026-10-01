import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { authFile, DEMO_WS, trackConsoleErrors } from "./helpers";

/**
 * Phase 2 owner flows (brief §AT) against the seeded demo workspace. The database persists between
 * runs, so names are made unique and every change made here is reversible (suppressions are lifted
 * again), keeping the suite re-runnable.
 */
const SAMPLE = path.join(process.cwd(), "samples", "leadvault-sample-prospects.csv");
const stamp = () => new Date().toISOString().replace(/\D/g, "").slice(0, 14);

async function importSample(page: Page, name: string) {
  await page.goto(`/w/${DEMO_WS}/imports/new`);
  await expect(page.getByRole("heading", { name: "New import" })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(SAMPLE);
  await expect(page.getByText("leadvault-sample-prospects.csv")).toBeVisible();
  await expect(page.getByText(/about 16 data rows detected/)).toBeVisible();
  await page.getByRole("button", { name: "Upload and continue" }).click();

  // Mapping: every standard column is suggested; "Specialty" is left for a decision.
  await expect(page.getByRole("button", { name: "Save mapping and continue" })).toBeVisible();
  await page.getByRole("button", { name: "Save mapping and continue" }).click();

  // Settings
  await expect(page).toHaveURL(/step=settings/);
  await page.getByLabel("Import name").fill(name);
  await page.getByRole("button", { name: "Validate and preview" }).click();

  // Preview
  await expect(page).toHaveURL(/step=preview/);
  await expect(page.getByRole("heading", { name: /What will happen — 16 rows/ })).toBeVisible();
  await page.getByRole("button", { name: /^Import \d+ prospects?$/ }).click();
  await page.getByRole("button", { name: "Import now" }).click();

  // Results
  await expect(page.getByRole("heading", { name: /What happened — 16 rows/ })).toBeVisible();
  return page.url().split("?")[0]!;
}

test.describe("flow 1 — import the fictional sample CSV", () => {
  test.use({ storageState: authFile("operator") });

  test("upload → map → settings → preview → confirm → results, with a safe export", async ({
    page,
  }) => {
    const errors = trackConsoleErrors(page);
    const importUrl = await importSample(page, `Sample E2E ${stamp()}`);
    const nav = page.getByRole("navigation", { name: "Filter rows by result" });
    await expect(nav.getByRole("link", { name: /Invalid/ })).toContainText("2");
    await expect(nav.getByRole("link", { name: /Duplicate/ })).toContainText("1");

    // Every row has an explainable outcome in the downloadable results.
    const res = await page.request.get(`${importUrl}/rows.csv`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-disposition"]).toContain("attachment");
    const text = await res.text();
    expect(text.trim().split(/\r?\n/)).toHaveLength(17);
    // Formula-injection protection: dangerous leading characters are neutralised.
    expect(text).toContain("'@Home Care Partners");
    expect(text).toContain("'=SUM(1+1)");
    expect(text).not.toMatch(/(^|,)=SUM/m);

    // The import is listed in history.
    await page.goto(`/w/${DEMO_WS}/imports`);
    await expect(page.getByRole("heading", { name: "Imports", level: 1 })).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe("flow 2 — inspect prospects and eligibility", () => {
  test.use({ storageState: authFile("operator") });

  test("search, filter and open a prospect with its reasons", async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await page.goto(`/w/${DEMO_WS}/prospects?q=${encodeURIComponent("Lone Star Family")}`);
    await page.getByRole("link", { name: "Lone Star Family Clinic" }).first().click();
    await expect(
      page.getByRole("heading", { name: "Lone Star Family Clinic", level: 1 }),
    ).toBeVisible();
    for (const section of [
      "Eligibility",
      "Company",
      "Contact",
      "Location",
      "Qualification",
      "Email verification",
      "Audiences",
      "Provenance",
      "Activity",
    ]) {
      await expect(page.getByRole("heading", { name: section, level: 2 })).toBeVisible();
    }
    await expect(page.getByText("Passes every eligibility rule.")).toBeVisible();

    // Georgia is unconfigured: held for review with the jurisdiction reason, never assumed legal.
    await page.goto(`/w/${DEMO_WS}/prospects?q=${encodeURIComponent("Peach State Orthodontics")}`);
    await page.getByRole("link", { name: "Peach State Orthodontics" }).first().click();
    await expect(page.getByText("Jurisdiction not approved").first()).toBeVisible();

    // Eligibility filter shortcuts narrow the list.
    await page.goto(`/w/${DEMO_WS}/prospects?eligibility=SUPPRESSED`);
    await expect(page.getByText(/prospects? match these filters/)).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe("flow 3 — build an audience from a filtered selection", () => {
  test.use({ storageState: authFile("operator") });

  test("select → add to a new audience → excluded prospects are reported", async ({ page }) => {
    const errors = trackConsoleErrors(page);
    const name = `E2E audience ${stamp()}`;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/w/${DEMO_WS}/prospects?country=US`);
    await page.getByRole("checkbox", { name: "Select all prospects on this page" }).first().click();
    const bulk = page.getByRole("region", { name: "Bulk actions" });
    await expect(bulk).toBeVisible();
    await bulk.getByRole("button", { name: "Add to audience" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/prospects? selected/)).toBeVisible();
    await dialog.getByLabel("Create a new audience").check();
    await dialog.getByLabel("Name").fill(name);
    await dialog.getByRole("button", { name: "Add prospects" }).click();
    await expect(dialog.getByRole("heading", { name: "Added to audience" })).toBeVisible();
    await expect(dialog.getByText(/Not added — review required/)).toBeVisible();
    await dialog.getByRole("link", { name: "Open audience" }).click();

    await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
    const summary = page.getByRole("region", { name: "Eligibility summary" });
    await expect(summary.getByText("Members")).toBeVisible();

    // Remove one member again.
    await page
      .getByRole("checkbox", { name: /^Select / })
      .nth(1)
      .click();
    await page.getByRole("button", { name: "Remove from audience" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    expect(errors).toEqual([]);
  });
});

test.describe("flow 4 — suppression overrides eligibility and is lifted with a reason", () => {
  test.use({ storageState: authFile("admin") });

  test("add a workspace suppression, see the prospect suppressed, then lift it", async ({
    page,
  }) => {
    const errors = trackConsoleErrors(page);
    const email = "avery.collins@lonestar-family-clinic.example";
    const liftIfActive = async () => {
      await page.goto(`/w/${DEMO_WS}/suppression?q=${encodeURIComponent(email)}`);
      const button = page.getByRole("button", { name: `Lift suppression for ${email}` });
      if ((await button.count()) === 0) return;
      await button.first().click();
      const lift = page.getByRole("dialog");
      await lift
        .getByLabel("Reason for lifting (required)")
        .fill("E2E test cleanup — suppression no longer needed");
      await lift.getByRole("button", { name: "Lift suppression" }).click();
      await expect(page.getByRole("dialog")).toBeHidden();
    };
    // Leave no trace from an interrupted earlier run.
    await liftIfActive();

    await page.goto(`/w/${DEMO_WS}/suppression`);
    await page.getByRole("button", { name: "Add suppression" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Email address or domain").fill(email);
    await dialog.getByLabel("Note (required)").fill("E2E test: temporary suppression");
    await dialog.getByRole("button", { name: "Add suppression" }).click();
    await expect(dialog.getByText(/re-evaluated/)).toBeVisible();
    await dialog.getByRole("button", { name: "Done" }).click();

    await page.goto(`/w/${DEMO_WS}/prospects?q=${encodeURIComponent("Lone Star Family")}`);
    await page.getByRole("link", { name: "Lone Star Family Clinic" }).first().click();
    await expect(page.getByText("Workspace suppression").first()).toBeVisible();

    await page.goto(`/w/${DEMO_WS}/suppression?q=${encodeURIComponent(email)}`);
    await page.getByRole("button", { name: `Lift suppression for ${email}` }).click();
    const lift = page.getByRole("dialog");
    await lift.getByRole("button", { name: "Lift suppression" }).click();
    // A reason is mandatory.
    await expect(lift.getByLabel("Reason for lifting (required)")).toBeVisible();
    await lift
      .getByLabel("Reason for lifting (required)")
      .fill("E2E test cleanup — suppression no longer needed");
    await lift.getByRole("button", { name: "Lift suppression" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();

    // History is preserved: the lifted record is still listed.
    await page.goto(`/w/${DEMO_WS}/suppression?status=lifted&q=${encodeURIComponent(email)}`);
    await expect(page.getByText(email).first()).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe("flow 5 — viewers can look but not change", () => {
  test.use({ storageState: authFile("viewer") });

  test("no import, selection or suppression controls; direct URLs are refused", async ({
    page,
  }) => {
    await page.goto(`/w/${DEMO_WS}/prospects`);
    await expect(page.getByRole("heading", { name: "Prospects", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Import", exact: true })).toHaveCount(0);
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await page.goto(`/w/${DEMO_WS}/suppression`);
    await expect(page.getByRole("button", { name: "Add suppression" })).toHaveCount(0);
    await page.goto(`/w/${DEMO_WS}/imports/new`);
    await expect(
      page.getByRole("heading", { name: "You don't have access to this page" }),
    ).toBeVisible();
  });
});

test.describe("flow 6 — another workspace cannot reach this data", () => {
  test("a prospect URL from workspace A is unavailable to a workspace B member", async ({
    browser,
    baseURL,
  }) => {
    // Find a real prospect URL as the owner of A…
    const owner = await browser.newContext({ baseURL, storageState: authFile("owner") });
    const p1 = await owner.newPage();
    await p1.goto(`/w/${DEMO_WS}/prospects?q=${encodeURIComponent("Lone Star Family")}`);
    const href = await p1
      .getByRole("link", { name: "Lone Star Family Clinic" })
      .first()
      .getAttribute("href");
    await p1.goto(`/w/${DEMO_WS}/imports`);
    const importHref = await p1
      .locator(`main a[href^="/w/${DEMO_WS}/imports/"]:not([href$="/new"])`)
      .first()
      .getAttribute("href");
    await owner.close();
    expect(href).toBeTruthy();

    // …then try it as the isolated user.
    const other = await browser.newContext({ baseURL, storageState: authFile("isolated") });
    const p2 = await other.newPage();
    await p2.goto(href!);
    await expect(p2.getByRole("heading", { name: "Workspace not available" })).toBeVisible();
    await expect(p2.getByText("Lone Star Family Clinic")).toHaveCount(0);
    expect(importHref).toBeTruthy();
    const res = await p2.request.get(`${importHref}/rows.csv`);
    expect(res.status()).toBe(404);
    await other.close();
  });
});
