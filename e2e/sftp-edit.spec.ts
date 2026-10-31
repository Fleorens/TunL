// T57b: Edit opens a remote file in its application, says when a save reached the server, and asks before
// replacing a version changed on the server. Mock: notes.txt saves once, .bashrc meets a conflict,
// backup.tar.gz is 700 MB.
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

async function menu(page: Page, name: string) {
  await names(page)
    .filter({ hasText: new RegExp(`^${name.replace(".", "\\.")}$`) })
    .click({ button: "right" });
  return page.getByRole("menu");
}

test("a file opens, and each save is reported", async ({ page }) => {
  await (await menu(page, "notes.txt")).getByRole("menuitem", { name: "Edit" }).click();
  await expect(page.getByText("notes.txt is open: each save is sent to the server")).toBeVisible();
  await expect(page.getByText("notes.txt saved to the server")).toBeVisible();
});

test("a version changed on the server is replaced only when asked", async ({ page }) => {
  await nas(page).getByRole("button", { name: "Show hidden files" }).click();
  await (await menu(page, ".bashrc")).getByRole("menuitem", { name: "Edit" }).click();

  const dialog = page.getByRole("alertdialog", { name: ".bashrc changed on the server" });
  await expect(dialog).toBeVisible();
  await expectSaneUi(page);
  await dialog.getByRole("button", { name: "Replace" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(".bashrc saved to the server")).toBeVisible();
});

test("a large file asks first, and Cancel opens nothing", async ({ page }) => {
  await (await menu(page, "backup.tar.gz")).getByRole("menuitem", { name: "Edit" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Open a large file?" });
  await expect(dialog).toContainText("backup.tar.gz is");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await page.waitForTimeout(500);
  await expect(page.getByText(/backup\.tar\.gz is open/)).toHaveCount(0);
});

test("a folder cannot be edited", async ({ page }) => {
  const folderMenu = await menu(page, "projects");
  await expect(folderMenu.getByRole("menuitem", { name: "Download" })).toBeVisible();
  await expect(folderMenu.getByRole("menuitem", { name: "Edit" })).toHaveCount(0);
});
