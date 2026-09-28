import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

function dialog(page: Page) {
  return page.getByRole("dialog");
}

async function openImport(page: Page) {
  await page.getByRole("button", { name: "Import connections", exact: true }).click();
  await expect(dialog(page).getByRole("heading", { name: "Import ~/.ssh/config" })).toBeVisible();
}

test("importing selected hosts into a group", async ({ page }) => {
  await openImport(page);
  await expect(dialog(page).getByText("Already present")).toBeVisible();
  await expect(dialog(page).getByRole("button", { name: "Import 3 connections" })).toBeEnabled();

  await dialog(page).getByRole("checkbox", { name: "Select legacy" }).click();
  await dialog(page).getByRole("combobox").click();
  await page.getByRole("option", { name: "Homelab", exact: true }).click();
  await dialog(page).getByRole("button", { name: "Import 2 connections" }).click();

  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByText("Imported 2 connections")).toBeVisible();
  const homelab = page.getByRole("region", { name: "Homelab", exact: true });
  await expect(homelab.getByRole("button", { name: /^staging/ })).toBeVisible();
  await expect(homelab.getByRole("button", { name: /^jump-box/ })).toBeVisible();
});

test("a host with an error cannot be selected", async ({ page }) => {
  await openImport(page);
  await expect(dialog(page).getByRole("checkbox", { name: "Select broken" })).toBeDisabled();
  await expect(
    dialog(page).getByText("host: must be a valid IPv4, IPv6 address or host name"),
  ).toBeVisible();
  await expect(dialog(page).getByText("ProxyCommand is ignored")).toBeVisible();
  await expectSaneUi(page);
});

test("select all toggles every selectable host", async ({ page }) => {
  await openImport(page);
  const all = dialog(page).getByRole("checkbox", { name: "Select all" });
  await all.click();
  await expect(dialog(page).getByRole("button", { name: "Import 4 connections" })).toBeEnabled();
  await all.click();
  await expect(dialog(page).getByRole("button", { name: "Import 0 connections" })).toBeDisabled();
});
