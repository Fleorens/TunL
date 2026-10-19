// T25b: the explorer's actions, over the mock file system of T24 (nas: home /home/admin).
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
    .getByRole("row", { name: new RegExp(`^${name.replace(".", "\\.")}\\b`) });
}

async function menu(page: Page, name: string, item: string) {
  await row(page, name).click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: item }).click();
}

test("a new folder from the toolbar, refused with a slash, created and selected", async ({
  page,
}) => {
  await nas(page).getByRole("button", { name: "New folder" }).click();
  const dialog = page.getByRole("dialog", { name: "New folder" });
  await dialog.getByLabel("Folder name").fill("a/b");
  await expect(dialog.getByText("nor contain “/”")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Create" })).toBeDisabled();
  await expectSaneUi(page);
  await dialog.getByLabel("Folder name").fill("reports");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row(page, "reports")).toHaveAttribute("aria-selected", "true");
});

test("the empty area's menu offers New folder only", async ({ page }) => {
  // Below the last line: the list is short, the tab is tall.
  const box = await nas(page).boundingBox();
  if (!box) throw new Error("the tab is on screen");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 40, { button: "right" });
  const items = page.getByRole("menu").getByRole("menuitem");
  await expect(items).toHaveText(["New folder"]);
});

test("rename in place: Enter keeps the new name, Escape gives up", async ({ page }) => {
  await menu(page, "notes.txt", "Rename");
  const field = nas(page).getByRole("textbox", { name: "Rename" });
  await expect(field).toBeFocused();
  await field.fill("todo.txt");
  await page.keyboard.press("Enter");
  await expect(row(page, "todo.txt")).toHaveAttribute("aria-selected", "true");
  await expect(names(page)).not.toContainText(["notes.txt"]);

  await page.keyboard.press("F2");
  await nas(page).getByRole("textbox", { name: "Rename" }).fill("other.txt");
  await page.keyboard.press("Escape");
  await expect(row(page, "todo.txt")).toBeVisible();
});

test("deleting a folder says how many entries go with it", async ({ page }) => {
  await menu(page, "projects", "Delete…");
  const confirm = page.getByRole("alertdialog", { name: "Delete “projects”?" });
  await expect(confirm).toContainText("4 items in all");
  await expectSaneUi(page);
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(names(page)).not.toContainText(["projects"]);

  // The Delete key asks too; Cancel keeps the file.
  await row(page, "notes.txt").click();
  await page.keyboard.press("Delete");
  const file = page.getByRole("alertdialog", { name: "Delete “notes.txt”?" });
  await expect(file).toContainText("This cannot be undone.");
  await file.getByRole("button", { name: "Cancel" }).click();
  await expect(row(page, "notes.txt")).toBeVisible();
});

test("permissions: the boxes and the octal field agree, and Apply changes the mode", async ({
  page,
}) => {
  await menu(page, "notes.txt", "Permissions…");
  const dialog = page.getByRole("dialog", { name: "Permissions of “notes.txt”" });
  const octal = dialog.getByLabel("Octal");
  await expect(octal).toHaveValue("644");
  await dialog.getByRole("checkbox", { name: "Group: Write" }).click();
  await expect(octal).toHaveValue("664");
  await octal.fill("6x");
  await expect(dialog.getByRole("button", { name: "Apply" })).toBeDisabled();
  await octal.fill("600");
  await expect(dialog.getByRole("checkbox", { name: "Others: Read" })).not.toBeChecked();
  await expectSaneUi(page);
  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect(row(page, "notes.txt")).toContainText("-rw-------");
});

test("Copy path puts the full path on the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await menu(page, "notes.txt", "Copy path");
  await expect(page.getByText("Copied to the clipboard")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("/home/admin/notes.txt");
});
