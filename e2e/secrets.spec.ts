import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

function editor(page: Page) {
  return page.getByRole("dialog");
}

async function openAuth(page: Page, name: string) {
  await page
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .first()
    .click({ button: "right" });
  await page.getByRole("menu").getByText("Edit", { exact: true }).click();
  await editor(page).getByRole("tab", { name: "Authentication" }).click();
}

test("a password typed in the editor is saved to the keyring", async ({ page }) => {
  await page.keyboard.press("Control+Shift+N");
  await editor(page).getByLabel("Name", { exact: true }).fill("vault");
  await editor(page).getByLabel("Host", { exact: true }).fill("10.9.9.9");
  await editor(page).getByRole("tab", { name: "Authentication" }).click();
  await editor(page).getByRole("radio", { name: "Password", exact: true }).click();
  await editor(page).getByLabel("Password (optional)").fill("hunter2");
  await editor(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor(page)).toHaveCount(0);

  await openAuth(page, "vault");
  await expect(editor(page).getByText("Saved in the keyring")).toBeVisible();
  await expect(editor(page).getByLabel("Password (optional)")).toHaveCount(0);
  await expectSaneUi(page);
});

test("forgetting a saved password takes effect on save", async ({ page }) => {
  await openAuth(page, "ad-01");
  await editor(page).getByRole("button", { name: "Forget", exact: true }).click();
  await expect(editor(page).getByText("Will be forgotten when you save")).toBeVisible();
  await editor(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor(page)).toHaveCount(0);

  await openAuth(page, "ad-01");
  await expect(editor(page).getByLabel("Password (optional)")).toBeVisible();
});

test("Replace then Cancel keeps the saved passphrase", async ({ page }) => {
  await openAuth(page, "db-prod");
  await editor(page).getByRole("button", { name: "Replace", exact: true }).click();
  await expect(editor(page).getByLabel("Key passphrase (optional)")).toBeVisible();
  await expectSaneUi(page);
  await editor(page).getByRole("button", { name: "Cancel", exact: true }).first().click();
  await expect(editor(page).getByText("Saved in the keyring")).toBeVisible();
});

test("closing with a typed secret asks first", async ({ page }) => {
  await openAuth(page, "db-prod");
  await editor(page).getByRole("button", { name: "Replace", exact: true }).click();
  await editor(page).getByLabel("Key passphrase (optional)").fill("new one");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toBeVisible();
});
