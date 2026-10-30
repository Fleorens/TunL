// T51: the palette hides empty groups, an RDP address opens the editor filled in, and the favorite item of the
// connection menu is a plain action.
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

function headings(page: Page) {
  return page.locator("[cmdk-group-heading]");
}

test("a search shows only the groups that have something", async ({ page }) => {
  await page.keyboard.press("Control+Shift+P");
  await page.keyboard.type("web");
  await expect(headings(page).filter({ hasText: /^Connections$/ })).toHaveCount(1);
  await expect(headings(page).filter({ hasText: /^Actions$/ })).toHaveCount(0);

  await page.keyboard.press("Control+a");
  await page.keyboard.type("settings");
  await expect(headings(page).filter({ hasText: /^Actions$/ })).toHaveCount(1);
  await expect(headings(page).filter({ hasText: /^Connections$/ })).toHaveCount(0);
});

test("an RDP address opens the editor filled in", async ({ page }) => {
  await page.keyboard.press("Control+Shift+T");
  await page.keyboard.type("rdp://10.0.0.9");
  await page.keyboard.press("Enter");
  const editor = page.getByRole("dialog");
  await expect(editor.getByRole("heading", { name: "New connection" })).toBeVisible();
  await expect(editor.getByRole("radio", { name: "RDP", exact: true })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(editor.getByRole("textbox", { name: /^Host/ })).toHaveValue("10.0.0.9");
  await expect(editor.getByRole("textbox", { name: /^Port/ })).toHaveValue("3389");
});

test("the favorite item of the connection menu is a plain action", async ({ page }) => {
  await page
    .getByRole("complementary")
    .getByRole("button", { name: /^web-01/ })
    .first()
    .click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Remove from favorites" })).toBeVisible();
  await expect(menu.getByRole("menuitemcheckbox")).toHaveCount(0);
});
