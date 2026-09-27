import { expect, type Page, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function row(page: Page, name: string) {
  return page.getByRole("button", { name: new RegExp(`^${escapeRegExp(name)}`) }).first();
}

function region(page: Page, name: string) {
  return page.getByRole("region", { name, exact: true });
}

async function openMenu(page: Page, name: string) {
  await row(page, name).click({ button: "right" });
  return page.getByRole("menu");
}

test("favoriting a connection adds it to the Favorites section", async ({ page }) => {
  const favorites = region(page, "Favorites");
  await expect(favorites.getByRole("button", { name: /^nas/ })).toHaveCount(0);
  const menu = await openMenu(page, "nas");
  await menu.getByText("Add to favorites", { exact: true }).click();
  await expect(favorites.getByRole("button", { name: /^nas/ })).toBeVisible();
});

test("moving a connection into a group, then out of it", async ({ page }) => {
  await openMenu(page, "router");
  await page.getByRole("menuitem", { name: "Move to group" }).hover();
  await page.getByRole("menuitem", { name: "Homelab" }).click();
  await expect(region(page, "Homelab").getByRole("button", { name: /^router/ })).toBeVisible();

  await openMenu(page, "router");
  await page.getByRole("menuitem", { name: "Move to group" }).hover();
  await page.getByRole("menuitem", { name: "No group" }).click();
  await expect(region(page, "Ungrouped").getByRole("button", { name: /^router/ })).toBeVisible();
});

test("duplicating a connection adds a numbered copy", async ({ page }) => {
  const menu = await openMenu(page, "web-02");
  await menu.getByText("Duplicate", { exact: true }).click();
  await expect(row(page, "web-02 (2)")).toBeVisible();
});

test("deleting a connection asks for confirmation", async ({ page }) => {
  const menu = await openMenu(page, "kiosk-01");
  await menu.getByText("Delete", { exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("kiosk-01");
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(row(page, "kiosk-01")).toHaveCount(0);
});

test("a bastion that is still in use cannot be deleted", async ({ page }) => {
  const menu = await openMenu(page, "bastion-01");
  await menu.getByText("Delete", { exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("Used by: db-prod, web-01, web-02")).toBeVisible();
  await expect(row(page, "bastion-01")).toBeVisible();
});

test("copying the address puts user@host on the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const menu = await openMenu(page, "web-01");
  await menu.getByText("Copy user@host", { exact: true }).click();
  await expect(page.getByText("Copied to the clipboard")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("deploy@10.0.0.12");
});

test("groups can be created, renamed and deleted", async ({ page }) => {
  await page.getByRole("button", { name: "New group", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill("Lab");
  await page.getByRole("dialog").getByRole("button", { name: "Create", exact: true }).click();
  await expect(region(page, "Lab")).toBeVisible();

  await region(page, "Lab").getByRole("button", { name: "Group actions" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill("Laboratory");
  await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
  await expect(region(page, "Laboratory")).toBeVisible();

  await region(page, "Homelab").getByRole("button", { name: "Group actions" }).click();
  await page.getByRole("menuitem", { name: "Delete group" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(region(page, "Homelab")).toHaveCount(0);
  await expect(region(page, "Ungrouped").getByRole("button", { name: /^nas/ })).toBeVisible();
});
