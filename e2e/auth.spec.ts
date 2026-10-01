import { expect, test } from "@playwright/test";
import { DEMO_WS, signIn, trackConsoleErrors } from "./helpers";

test.describe("authentication protection", () => {
  test("protected pages redirect to login and remember the destination", async ({ page }) => {
    await page.goto(`/w/${DEMO_WS}/campaigns`);
    await expect(page).toHaveURL(/\/login\?next=%2Fw%2Fnorthwind-demo%2Fcampaigns/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("every module route is protected", async ({ request }) => {
    for (const path of [
      "/dashboard",
      "/prospects",
      `/w/${DEMO_WS}/settings/audit-log`,
      `/w/${DEMO_WS}/profile`,
    ]) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(307);
      expect(res.headers().location, path).toContain("/login");
    }
  });

  test("wrong credentials get one generic message (no account enumeration)", async ({ page }) => {
    await signIn(page, "owner", "Definitely-Wrong-Password-1");
    await expect(page.locator("form").getByRole("alert")).toHaveText(
      "The email or password is incorrect.",
    );
    await page.getByLabel("Email").fill("nobody@leadvault-demo.test");
    await page.getByLabel("Password").fill("Definitely-Wrong-Password-1");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.locator("form").getByRole("alert")).toHaveText(
      "The email or password is incorrect.",
    );
  });

  test("validation errors are announced per field", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Enter a valid email address.")).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
  });

  test("sign in lands on the workspace dashboard, and sign out ends the session", async ({
    page,
  }) => {
    const errors = trackConsoleErrors(page);
    await signIn(page, "operator");
    await expect(page).toHaveURL(new RegExp(`/w/${DEMO_WS}/dashboard`));
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login\?signed_out=1/);
    await page.goto(`/w/${DEMO_WS}/dashboard`);
    await expect(page).toHaveURL(/\/login/);
    expect(errors).toEqual([]);
  });

  test("post-login redirect cannot be pointed off-site", async ({ page }) => {
    await page.goto("/login?next=//evil.example/phish");
    await page.getByLabel("Email").fill("viewer@leadvault-demo.test");
    const { demoPassword } = await import("./helpers");
    await page.getByLabel("Password").fill(demoPassword());
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(new RegExp("/w/" + DEMO_WS + "/dashboard$"));
    expect(new URL(page.url()).hostname).toBe("localhost");
  });

  test("password reset request never reveals whether an account exists", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill("does-not-exist@leadvault-demo.test");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("status")).toContainText("If an account exists for that address");
  });

  test("security headers are set", async ({ request }) => {
    const res = await request.get("/login");
    const h = res.headers();
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["content-security-policy"]).toMatch(/script-src 'self' 'nonce-/);
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-powered-by"]).toBeUndefined();
  });
});
