// T46: an upload that ends while you browse elsewhere leaves you where you are.
// Mock: a dropped file whose name ends with ".iso" takes five progress steps.
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

function transfers(page: Page) {
  return nas(page).getByRole("list", { name: "Transfers" });
}

test("an upload that ends while you browse elsewhere leaves you in that other folder", async ({
  page,
}) => {
  const list = nas(page).getByRole("table", { name: "Files" });
  const files = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["x"], "disk.iso"));
    return transfer;
  });
  await list.dispatchEvent("dragover", { dataTransfer: files });
  await list.dispatchEvent("drop", { dataTransfer: files });

  await names(page)
    .filter({ hasText: /^projects$/ })
    .dblclick();
  await expect(names(page).first()).toHaveText("app");
  await expect(transfers(page).getByRole("listitem", { name: "disk.iso" })).toContainText("Done");
  await page.waitForTimeout(500);
  await expect(names(page).first()).toHaveText("app");
});

test("an upload that ends in the folder shown lists the new file", async ({ page }) => {
  const list = nas(page).getByRole("table", { name: "Files" });
  const files = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["x"], "image.iso"));
    return transfer;
  });
  await list.dispatchEvent("dragover", { dataTransfer: files });
  await list.dispatchEvent("drop", { dataTransfer: files });
  await expect(transfers(page).getByRole("listitem", { name: "image.iso" })).toContainText("Done");
  await expect(names(page)).toContainText(["image.iso"]);
});
