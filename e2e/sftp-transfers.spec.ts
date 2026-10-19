// T26: downloads from the explorer, and the transfers panel (mock: backup.tar.gz is 700 MB, a few seconds).
import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^nas/ }).first().click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Open in SFTP" }).click();
  await expect(row(page, "notes.txt")).toBeVisible();
});

function nas(page: Page) {
  return page.getByRole("region", { name: "nas", exact: true });
}

function row(page: Page, name: string) {
  return nas(page)
    .getByRole("table", { name: "Files" })
    .getByRole("row", { name: new RegExp(`^${name.replace(".", "\\.")}\\b`) });
}

function transfers(page: Page) {
  return nas(page).getByRole("list", { name: "Transfers" });
}

test("double-clicking a file downloads it; the panel says when it is done", async ({ page }) => {
  await row(page, "notes.txt").dblclick();
  await expect(nas(page).getByRole("button", { name: "Transfers (1)" })).toBeVisible();
  const line = transfers(page).getByRole("listitem", { name: "notes.txt" });
  await expect(line).toContainText("Done");
  await expect(line.getByRole("button", { name: "Show notes.txt in its folder" })).toBeVisible();
  await expectSaneUi(page);
});

test("a folder has no Download in its menu; a file has", async ({ page }) => {
  await row(page, "projects").click({ button: "right" });
  await expect(page.getByRole("menu").getByRole("menuitem", { name: "Download" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await row(page, "notes.txt").click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Download" }).click();
  await expect(transfers(page).getByRole("listitem", { name: "notes.txt" })).toContainText("Done");
});

test("a long download shows its progress and can be cancelled", async ({ page }) => {
  await row(page, "backup.tar.gz").dblclick();
  const line = transfers(page).getByRole("listitem", { name: "backup.tar.gz" });
  await expect(line.getByRole("progressbar")).toBeVisible();
  await expect(line).toContainText("/s");
  await line.getByRole("button", { name: "Cancel backup.tar.gz" }).click();
  await expect(line).toContainText("Cancelled");
  await expect(line.getByRole("progressbar")).toHaveCount(0);
});

test("Clear finished empties the panel, which then goes away", async ({ page }) => {
  await row(page, "notes.txt").dblclick();
  await expect(transfers(page).getByRole("listitem", { name: "notes.txt" })).toContainText("Done");
  await nas(page).getByRole("button", { name: "Clear finished" }).click();
  await expect(transfers(page)).toHaveCount(0);
});

test("the panel folds away and comes back", async ({ page }) => {
  await row(page, "notes.txt").dblclick();
  const toggle = nas(page).getByRole("button", { name: "Transfers (1)" });
  await expect(transfers(page)).toBeVisible();
  await toggle.click();
  await expect(transfers(page)).toHaveCount(0);
  await toggle.click();
  await expect(transfers(page)).toBeVisible();
});
