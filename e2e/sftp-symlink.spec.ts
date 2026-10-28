// T48: a link to a file downloads like a file, from a double-click or from its menu.
// Mock: in the home folder, "current" is a link to a 4 KiB file.
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^nas/ }).first().click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Open in SFTP" }).click();
  await expect(names(page).first()).toHaveText("projects");
});

function nas(page: Page) {
  return page.getByRole("region", { name: "nas", exact: true });
}

function names(page: Page) {
  return nas(page).getByRole("table", { name: "Files" }).locator("tbody tr td:first-child");
}

test("double-clicking a link to a file downloads it and stays in the folder", async ({ page }) => {
  await names(page)
    .filter({ hasText: /^current$/ })
    .dblclick();
  await expect(
    nas(page).getByRole("list", { name: "Transfers" }).getByRole("listitem", { name: "current" }),
  ).toContainText("Done");
  await expect(names(page).first()).toHaveText("projects");
});

test("the menu of a link to a file offers Download", async ({ page }) => {
  await names(page)
    .filter({ hasText: /^current$/ })
    .click({ button: "right" });
  await expect(page.getByRole("menu").getByRole("menuitem", { name: "Download" })).toBeVisible();
});
