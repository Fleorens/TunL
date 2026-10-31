// T55: a folder downloads from its menu, as one line of the transfers panel with its file count.
// Mock: projects holds README.md and app/main.rs.
import { expect, type Page, test } from "./support/test.ts";

function nas(page: Page) {
  return page.getByRole("region", { name: "nas", exact: true });
}

function names(page: Page) {
  return nas(page).getByRole("table", { name: "Files" }).locator("tbody tr td:first-child");
}

test("a folder downloads with its files, in one line", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^nas/ }).first().click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Open in SFTP" }).click();
  await expect(names(page).first()).toHaveText("projects");

  await names(page)
    .filter({ hasText: /^projects$/ })
    .click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Download" }).click();

  const line = nas(page)
    .getByRole("list", { name: "Transfers" })
    .getByRole("listitem", { name: "projects" });
  await expect(line).toContainText("2 files");
  await expect(line).toContainText("Done");
  await expect(names(page).first()).toHaveText("projects");
});
