// T56: a folder dropped from the desktop, or picked with "Upload a folder", is sent with its content.
// Mock: the desktop folder "photos" holds 3 images and 1 link; the picked folder "Transfers" holds 2 files.
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

function line(page: Page, name: string) {
  return nas(page).getByRole("list", { name: "Transfers" }).getByRole("listitem", { name });
}

async function dropFolder(page: Page, name: string) {
  const list = nas(page).getByRole("table", { name: "Files" });
  const files = await page.evaluateHandle((folder) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([""], folder));
    return transfer;
  }, name);
  await list.dispatchEvent("dragover", { dataTransfer: files });
  await list.dispatchEvent("drop", { dataTransfer: files });
}

test("a dropped folder is sent with its files, and its link is skipped", async ({ page }) => {
  await dropFolder(page, "photos");
  await expect(line(page, "photos")).toContainText("3 files");
  await expect(line(page, "photos")).toContainText("Done");
  await expect(line(page, "photos")).toContainText("1 link skipped");
  await expect(names(page)).toContainText(["photos"]);

  await names(page)
    .filter({ hasText: /^photos$/ })
    .dblclick();
  await expect(names(page)).toHaveText(["IMG_1.jpg", "IMG_2.jpg", "IMG_3.jpg"]);
});

test("a folder sent twice takes a free name", async ({ page }) => {
  await dropFolder(page, "photos");
  await expect(line(page, "photos")).toContainText("Done");
  await nas(page).getByRole("button", { name: "Clear finished" }).click();
  await dropFolder(page, "photos");
  await expect(line(page, "photos")).toContainText("Done");
  await expect(names(page)).toContainText(["photos", "photos (1)"]);
});

test("Upload a folder sends the folder picked", async ({ page }) => {
  await nas(page).getByRole("button", { name: "Upload a folder" }).click();
  await expect(line(page, "Transfers")).toContainText("2 files");
  await expect(line(page, "Transfers")).toContainText("Done");
  await expect(names(page)).toContainText(["Transfers"]);
});
