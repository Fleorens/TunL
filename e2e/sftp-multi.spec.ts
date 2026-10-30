// T54: several rows of the SFTP table are selected with Ctrl, Shift or Ctrl+A, then downloaded or deleted at once.
// Mock: the home folder of nas shows projects (4 items with its content), backup.tar.gz, current, notes.txt.
import { expectSaneUi } from "./support/sanity.ts";
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

function row(page: Page, name: string) {
  return nas(page)
    .getByRole("table", { name: "Files" })
    .locator("tbody tr")
    .filter({ has: page.locator("td:first-child", { hasText: new RegExp(`^${name}$`) }) });
}

function selected(page: Page) {
  return nas(page).locator('tbody tr[aria-selected="true"]');
}

test("Ctrl+click selects two files, and the menu acts on both", async ({ page }) => {
  await row(page, "notes.txt").click();
  await row(page, "backup.tar.gz").click({ modifiers: ["Control"] });
  await expect(selected(page)).toHaveCount(2);

  await row(page, "notes.txt").click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Download 2 items" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /^Delete 2 items/ })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Rename" })).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: /^Permissions/ })).toHaveCount(0);

  await menu.getByRole("menuitem", { name: "Download 2 items" }).click();
  const transfers = nas(page).getByRole("list", { name: "Transfers" });
  await expect(transfers.getByRole("listitem", { name: "notes.txt" })).toBeVisible();
  await expect(transfers.getByRole("listitem", { name: "backup.tar.gz" })).toBeVisible();
});

test("Shift+click selects a range, Ctrl+A selects every row shown", async ({ page }) => {
  await row(page, "backup.tar.gz").click();
  await row(page, "notes.txt").click({ modifiers: ["Shift"] });
  await expect(selected(page)).toHaveCount(3);
  await expect(row(page, "projects")).toHaveAttribute("aria-selected", "false");

  await page.keyboard.press("Control+a");
  await expect(selected(page)).toHaveCount(4);
});

test("one confirmation deletes several entries, with the total counted first", async ({ page }) => {
  await row(page, "projects").click();
  await row(page, "notes.txt").click({ modifiers: ["Control"] });
  await page.keyboard.press("Delete");

  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("heading", { name: "Delete 2 items?" })).toBeVisible();
  await expect(dialog).toContainText("5 items in all will be deleted.");
  await expectSaneUi(page);
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();

  await expect(dialog).toHaveCount(0);
  await expect(names(page)).toHaveText(["backup.tar.gz", "current"]);
});

test("the selection survives a sort, not a change of folder", async ({ page }) => {
  await row(page, "notes.txt").click();
  await row(page, "current").click({ modifiers: ["Control"] });
  await nas(page).getByRole("button", { name: "Size" }).click();
  await expect(selected(page)).toHaveCount(2);

  await row(page, "projects").dblclick();
  await expect(names(page).first()).toHaveText("app");
  await expect(selected(page)).toHaveCount(0);
});
