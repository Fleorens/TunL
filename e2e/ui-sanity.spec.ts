// Generic UI checks (e2e/support/sanity.ts) on every screen that exists. A sheet that adds a screen calls
// `expectSaneUi` in its own scenarios; this file covers what lots 1 and 2 built.
import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

function editor(page: Page) {
  return page.getByRole("dialog");
}

async function visitTabs(page: Page) {
  for (const tab of ["General", "Authentication", "Network", "Advanced"]) {
    await editor(page).getByRole("tab", { name: tab }).click();
    await expectSaneUi(page);
  }
}

test("the main window", async ({ page }) => {
  await expect(page.getByRole("region", { name: "Favorites" })).toBeVisible();
  await expectSaneUi(page);
});

test("the editor, every tab, SSH then RDP", async ({ page }) => {
  await page.keyboard.press("Control+Shift+N");
  await visitTabs(page);
  await editor(page).getByRole("radio", { name: "RDP", exact: true }).click();
  await visitTabs(page);
});

test("the editor of an existing connection, with errors and Wake-on-LAN", async ({ page }) => {
  await page
    .getByRole("button", { name: /^web-01/ })
    .first()
    .click({ button: "right" });
  await page.getByRole("menu").getByText("Edit", { exact: true }).click();
  await editor(page).getByLabel("Host", { exact: true }).fill("bad host!");
  await editor(page).getByLabel("Name", { exact: true }).fill("");
  await expectSaneUi(page);
  await editor(page).getByRole("tab", { name: "Network" }).click();
  await editor(page).getByRole("switch").first().click();
  await expectSaneUi(page);
});

test("menus and small dialogs", async ({ page }) => {
  await page.getByRole("button", { name: /^nas/ }).first().click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await expectSaneUi(page);
  await page.getByRole("menu").getByText("Delete", { exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expectSaneUi(page);
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "New group" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expectSaneUi(page);
});

test("the home screen", async ({ page }) => {
  await page.keyboard.press("Control+Shift+W");
  await page.keyboard.press("Control+Shift+W");
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expectSaneUi(page);
});
