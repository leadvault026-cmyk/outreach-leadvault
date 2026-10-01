import { expect, test as setup } from "@playwright/test";
import { authFile, signIn, USERS, type DemoUser } from "./helpers";

for (const user of Object.keys(USERS) as DemoUser[]) {
  setup(`authenticate ${user}`, async ({ page }) => {
    await signIn(page, user);
    await expect(page).toHaveURL(/\/(w\/[a-z0-9-]+\/dashboard|dashboard)/);
    await page.context().storageState({ path: authFile(user) });
  });
}
