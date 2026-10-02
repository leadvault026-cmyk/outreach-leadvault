import { execFileSync } from "node:child_process";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { authFile, DEMO_WS, trackConsoleErrors, type DemoUser } from "./helpers";

/**
 * The complete MVP walkthrough with the FAKE email transport (nothing leaves the machine):
 * audience → campaign → 3-step sequence → preview → launch → worker sends → reply stops the
 * sequence → hard bounce suppresses → unsubscribe link → inbox → results → stop.
 * The worker runs as its own process (`--once`), exactly like `npm run worker`.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(6 * 60_000);

const MAILBOX = "alex@northwind-outreach.example";
const stamp = () => new Date().toISOString().replace(/\D/g, "").slice(0, 14);

function runWorkerOnce(): string {
  return execFileSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "src/worker/main.ts", "--once"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 120_000,
    },
  );
}

async function as(browser: Browser, baseURL: string | undefined, user: DemoUser) {
  const ctx = await browser.newContext({ baseURL, storageState: authFile(user) });
  return { ctx, page: await ctx.newPage() };
}

async function setMailbox(page: Page, seconds: number, dailyLimit: number) {
  await page.goto(`/w/${DEMO_WS}/mailboxes`);
  await page.getByRole("button", { name: `Settings for ${MAILBOX}` }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Seconds between emails").fill(String(seconds));
  await dialog.getByLabel("Daily sending limit").fill(String(dailyLimit));
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
}

async function stopLeftoverE2eCampaigns(page: Page) {
  await page.goto(`/w/${DEMO_WS}/campaigns`);
  const rows = page.locator("table tbody tr").filter({ hasText: "E2E MVP" });
  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    if (!/Running|Paused|Scheduled/.test(await row.innerText())) continue;
    const href = await row.getByRole("link").first().getAttribute("href");
    await page.goto(href!);
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Stop campaign" }).click();
    await expect(page.getByText("Stopped").first()).toBeVisible();
    await page.goto(`/w/${DEMO_WS}/campaigns`);
  }
}

test("complete MVP flow with the fake transport", async ({ browser, baseURL }) => {
  const admin = await as(browser, baseURL, "admin");
  await test.step("admin: tidy earlier runs and remove mailbox spacing for a fast test", async () => {
    await stopLeftoverE2eCampaigns(admin.page);
    await setMailbox(admin.page, 0, 2000); // test-only; restored at the end
  });

  const { ctx, page } = await as(browser, baseURL, "operator");
  const errors = trackConsoleErrors(page);
  const name = `E2E MVP ${stamp()}`;
  let campaignUrl = "";

  await test.step("create a campaign for an audience", async () => {
    await page.goto(`/w/${DEMO_WS}/campaigns/new`);
    await expect(page.getByRole("heading", { name: "New campaign", level: 1 })).toBeVisible();
    await page.getByLabel("Name", { exact: true }).fill(name);
    const audience = await page
      .locator("#c-aud option", { hasText: "Texas Medical Providers" })
      .getAttribute("value");
    await page.getByLabel("Audience").selectOption(audience!);
    const mailbox = await page.locator("#c-mb option", { hasText: MAILBOX }).getAttribute("value");
    await page.getByLabel("Sending mailbox").selectOption(mailbox!);
    await page.getByLabel(/Any day and time/).check();
    await page.getByRole("button", { name: /Create campaign/ }).click();
    await expect(page).toHaveURL(/tab=sequence/);
    campaignUrl = page.url().split("?")[0]!;
  });

  await test.step("build a 3-step sequence from templates", async () => {
    await page
      .getByLabel(/Start from a template/)
      .first()
      .selectOption({ label: "1 · Introduction" });
    for (const [i, tpl] of [
      [2, "2 · Follow-up"],
      [3, "3 · Final note"],
    ] as const) {
      await page.getByRole("button", { name: "Add follow-up" }).click();
      await page
        .getByLabel(/Start from a template/)
        .nth(i - 1)
        .selectOption({ label: tpl });
      await page
        .getByLabel("Wait after the previous email")
        .nth(i - 2)
        .fill("1");
      await page
        .getByLabel("Unit")
        .nth(i - 2)
        .selectOption("minutes");
    }
    await page.getByRole("button", { name: "Save sequence" }).click();
    await expect(page.getByText("Sequence saved.")).toBeVisible();
  });

  await test.step("preview personalization and exclusions, then launch", async () => {
    await page.goto(`${campaignUrl}?tab=preview`);
    const preview = page.getByRole("region", { name: "Who will receive this campaign" });
    await expect(preview.getByText("Will receive")).toBeVisible();
    const article = page.locator("article").first();
    await expect(article).toContainText("Hi ");
    await expect(article).toContainText("opt out here: [personal unsubscribe link]");
    await expect(page.locator("article").filter({ hasText: /\{\{|undefined/ })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Who is left out, and why" })).toBeVisible();
    // Excluded prospects are listed with plain-language reasons (e.g. unverified emails).
    const leftOut = page.locator("section", {
      has: page.getByRole("heading", { name: "Who is left out, and why" }),
    });
    await expect(leftOut.locator("li").first()).toBeVisible();
    await page.getByRole("button", { name: "Launch campaign" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Launch now" }).click();
    await expect(page.getByText("Campaign launched")).toBeVisible();
    await expect(page.getByText("Running").first()).toBeVisible();
  });

  let sentAfterFirstRun = 0;
  await test.step("the worker sends step 1 (fake transport) without duplicates", async () => {
    const log = runWorkerOnce();
    expect(log).toContain("FAKE");
    expect(log).toMatch(/Sent message/);
    await page.goto(`${campaignUrl}?tab=overview`);
    const tile = page
      .getByRole("region", { name: "Campaign results" })
      .locator("div", { hasText: /^Emails sent/ });
    sentAfterFirstRun = Number((await tile.locator("p").nth(1).innerText()).replace(/\D/g, ""));
    expect(sentAfterFirstRun).toBeGreaterThan(2);
    runWorkerOnce(); // nothing is due: running again must not send anything twice
    await page.reload();
    expect(Number((await tile.locator("p").nth(1).innerText()).replace(/\D/g, ""))).toBe(
      sentAfterFirstRun,
    );
  });

  const recipients = page.getByRole("list", { name: "Recipients" }).locator("li");
  // Recipients that have been emailed (only they have the Test menu).
  const emailed = recipients.filter({ has: page.getByRole("button", { name: /Test events for/ }) });
  let unsubscribeHref = "";
  let bouncedEmail = "";
  let repliedCompany = "";
  await test.step("simulate a reply, a hard bounce and grab an unsubscribe link", async () => {
    await page.goto(`${campaignUrl}?tab=recipients&filter=live`);
    const first = emailed.nth(0);
    repliedCompany = (await first.getByRole("link").first().innerText()).trim();
    await first.getByRole("button", { name: /Test events for/ }).click();
    await page.getByRole("menuitem", { name: "Simulate a reply" }).click();
    await expect(first.getByText(/remaining sequence for this prospect has stopped/)).toBeVisible();

    await page.goto(`${campaignUrl}?tab=recipients&filter=live`);
    const second = emailed.nth(0);
    bouncedEmail = ((await second.locator("p").first().innerText()).split("·").pop() ?? "").trim();
    await second.getByRole("button", { name: /Test events for/ }).click();
    await page.getByRole("menuitem", { name: "Simulate a hard bounce" }).click();
    await expect(second.getByText(/Hard bounce recorded/)).toBeVisible();

    await page.goto(`${campaignUrl}?tab=recipients&filter=live`);
    await recipients
      .nth(0)
      .getByRole("button", { name: /Test events for/ })
      .click();
    unsubscribeHref = (await page
      .getByRole("menuitem", { name: /unsubscribe page/ })
      .getAttribute("href"))!;
    await page.keyboard.press("Escape");
    expect(unsubscribeHref).toMatch(/^\/u\/v1\./);
  });

  await test.step("the recipient unsubscribes through the public page (no login)", async () => {
    const anon = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    const p = await anon.newPage();
    await p.goto(unsubscribeHref);
    await expect(p.getByRole("heading", { name: "Email preferences" })).toBeVisible();
    await expect(p.getByText("@")).toHaveCount(0); // nothing about the recipient is shown
    await p.getByRole("button", { name: "Unsubscribe" }).click();
    await expect(p.getByText("You have been unsubscribed.")).toBeVisible();
    await p.goto("/u/v1.invalid-token-value.x");
    await expect(p.getByText("This link is not valid")).toBeVisible();
    await anon.close();
  });

  await test.step("follow-ups go out only to recipients who did not reply, bounce or unsubscribe", async () => {
    await page.waitForTimeout(65_000); // step 2 is due 1 minute after step 1
    runWorkerOnce();
    await page.goto(`${campaignUrl}?tab=recipients&filter=stopped`);
    await expect(page.getByText("Bounced").first()).toBeVisible();
    await expect(page.getByText("Unsubscribed").first()).toBeVisible();
    await page.goto(`${campaignUrl}?tab=recipients&filter=replied`);
    await expect(recipients).toHaveCount(1);
    await expect(recipients.first()).toContainText("1 of 3 sent");
    await page.goto(`${campaignUrl}?tab=recipients&filter=live`);
    await expect(recipients.filter({ hasText: "2 of 3 sent" }).first()).toBeVisible();
  });

  await test.step("the reply is in the Inbox and can be classified", async () => {
    await page.goto(`/w/${DEMO_WS}/inbox`);
    const thread = page
      .getByRole("list", { name: "Conversations" })
      .getByRole("link")
      .filter({ hasText: repliedCompany })
      .first();
    await expect(thread).toBeVisible();
    await thread.click();
    await expect(page.getByRole("list", { name: "Conversation" })).toContainText(
      "Thanks for reaching out",
    );
    await expect(page.getByText("Replied").first()).toBeVisible();
    await page.getByRole("button", { name: "Interested", exact: true }).click();
    await expect(page.getByText("Classification saved.")).toBeVisible();
  });

  await test.step("results and suppression reflect what happened", async () => {
    await page.goto(`${campaignUrl}?tab=overview`);
    const results = page.getByRole("region", { name: "Campaign results" });
    for (const label of ["Replied", "Positive replies", "Bounced", "Unsubscribed"]) {
      await expect(
        results
          .locator("div", { hasText: new RegExp(`^${label}`) })
          .locator("p")
          .nth(1),
      ).toHaveText("1");
    }
    await page.goto(`/w/${DEMO_WS}/suppression?q=${encodeURIComponent(bouncedEmail)}`);
    await expect(page.getByRole("cell", { name: "LeadVault-wide" })).toBeVisible();
    await expect(page.getByRole("cell", { name: /Hard bounce/ })).toBeVisible();
  });

  await test.step("stop the campaign: nothing else is sent", async () => {
    await page.goto(`${campaignUrl}?tab=overview`);
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Stop campaign" }).click();
    await expect(page.getByText("Stopped").first()).toBeVisible();
    runWorkerOnce();
    await page.goto(`${campaignUrl}?tab=recipients&filter=live`);
    await expect(page.getByText("No recipients in this view.")).toBeVisible();
  });

  expect(errors).toEqual([]);
  await ctx.close();
  await setMailbox(admin.page, 5, 50);
  await admin.ctx.close();
});

test("another workspace cannot open this workspace's campaigns", async ({ browser, baseURL }) => {
  const op = await as(browser, baseURL, "operator");
  await op.page.goto(`/w/${DEMO_WS}/campaigns`);
  const href = await op.page.locator("table tbody tr a").first().getAttribute("href");
  await op.ctx.close();
  const iso = await as(browser, baseURL, "isolated");
  await iso.page.goto(href!);
  await expect(iso.page.getByRole("heading", { name: "Workspace not available" })).toBeVisible();
  await iso.ctx.close();
});

test("viewers can see campaigns but not change them", async ({ browser, baseURL }) => {
  const v = await as(browser, baseURL, "viewer");
  await v.page.goto(`/w/${DEMO_WS}/campaigns`);
  await expect(v.page.getByRole("link", { name: "New campaign" })).toHaveCount(0);
  await v.page.goto(`/w/${DEMO_WS}/campaigns/new`);
  await expect(
    v.page.getByRole("heading", { name: "You don't have access to this page" }),
  ).toBeVisible();
  await v.page.goto(`/w/${DEMO_WS}/templates/new`);
  await expect(
    v.page.getByRole("heading", { name: "You don't have access to this page" }),
  ).toBeVisible();
  await v.ctx.close();
});
