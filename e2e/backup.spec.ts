// T32: Settings › Backup — export the connections, import a file (mock: nas already here, backup-01 new).
import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Control+,");
  await settings(page).getByRole("navigation").getByRole("button", { name: "Backup" }).click();
});

function settings(page: Page) {
  return page.getByRole("region", { name: "Settings", exact: true });
}

test("export says how many connections went to the file", async ({ page }) => {
  await expectSaneUi(page);
  await settings(page).getByRole("button", { name: "Export connections" }).click();
  await expect(page.getByText(/^\d+ connections exported$/)).toBeVisible();
  await expect(page.getByText("/home/user/tunl-connections.json")).toBeVisible();
});

test("import adds what is new, leaves out what is already here, and the list shows it", async ({
  page,
}) => {
  const sidebar = page.getByRole("complementary");
  await expect(sidebar.getByRole("button", { name: /^backup-01/ })).toHaveCount(0);

  await settings(page).getByRole("button", { name: "Import connections" }).click();
  await expect(page.getByText("1 connection added · 1 already here")).toBeVisible();
  await expect(sidebar.getByRole("button", { name: /^backup-01/ })).toBeVisible();
  await expect(sidebar.getByRole("region", { name: "Backups" })).toContainText("backup-01");

  await settings(page).getByRole("button", { name: "Import connections" }).click();
  await expect(page.getByText("0 connections added · 2 already here")).toBeVisible();
  await expect(sidebar.getByRole("button", { name: /^backup-01/ })).toHaveCount(1);
});
