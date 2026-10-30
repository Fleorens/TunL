// Regressions found at the lot 7 review (T43–T53): each scenario pins a defect that `npm run review` had missed.
import { expect, type Page, test } from "./support/test.ts";

function nameField(page: Page) {
  return page.getByRole("dialog").getByRole("textbox", { name: /^Name/ });
}

test("a new connection opens on the Name field once the app has loaded, every time", async ({
  page,
}) => {
  // T44's test opened the editor while the app was still loading: the focus only worked then.
  await page.goto("/");
  await expect(page.getByRole("button", { name: /^web-01/ }).first()).toBeVisible();
  await page.waitForTimeout(500);
  await page.keyboard.press("Control+Shift+N");
  await expect(nameField(page)).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("Control+Shift+N");
  await expect(nameField(page)).toBeFocused();
});
