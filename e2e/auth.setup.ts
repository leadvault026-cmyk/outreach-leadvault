import { expect, test as setup } from "@playwright/test";
import { authFile, signIn, USERS, type DemoUser } from "./helpers";

for (const user of Object.keys(USERS) as DemoUser[]) {
  setup(`authenticate ${user}`, async ({ page }) => {
    setup.setTimeout(120_000);
    await signIn(page, user);
    // On the local Docker stack, Supabase Auth's own database connection occasionally times out
    // after idle time (seen in its logs as "dial tcp …:5432: i/o timeout"). The app now reports
    // that as "Couldn't reach the server"; retry once instead of failing the whole suite.
    const unavailable = page.getByText("Couldn't reach the server");
    const landed = page.waitForURL(/\/(w\/[a-z0-9-]+\/dashboard|dashboard)/, { timeout: 60_000 });
    const outcome = await Promise.race([
      landed.then(() => "ok" as const),
      unavailable.waitFor({ timeout: 60_000 }).then(() => "retry" as const),
    ]).catch(() => "fail" as const);
    if (outcome === "retry") await signIn(page, user);
    await expect(page).toHaveURL(/\/(w\/[a-z0-9-]+\/dashboard|dashboard)/, { timeout: 60_000 });
    await page.context().storageState({ path: authFile(user) });
  });
}
