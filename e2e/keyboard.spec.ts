// T34: the keyboard reaches everything — sidebar rows, the tab row, menus — and every icon button says what it does.
import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

function sidebarRows(page: Page) {
  return page.getByRole("complementary").locator("[data-sidebar-row]");
}

test("arrows, Home and End move from row to row across the sidebar sections", async ({ page }) => {
  const rows = sidebarRows(page);
  await rows.first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press("End");
  await expect(rows.last()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(rows.last()).toBeFocused();
  await page.keyboard.press("Home");
  await expect(rows.first()).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(rows.first()).toBeFocused();
});

test("Shift+F10 opens the menu of the focused row, Enter connects", async ({ page }) => {
  const nas = sidebarRows(page).filter({ hasText: /^nas/ }).first();
  await nas.focus();
  await page.keyboard.press("Shift+F10");
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Open in SFTP" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  await nas.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { selected: true })).toContainText("nas");
});

test("Left and Right move along the tab row, wrapping around; Enter opens the tab", async ({
  page,
}) => {
  for (const name of ["nas", "pi-hole"]) {
    await sidebarRows(page)
      .filter({ hasText: new RegExp(`^${name}`) })
      .first()
      .dblclick();
  }
  await page.keyboard.press("Control+,");
  const tab = (name: string) => page.getByRole("tab", { name: new RegExp(name) });
  await tab("Settings").focus();

  await page.keyboard.press("ArrowRight");
  await expect(tab("nas")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(tab("Settings")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(tab("nas")).toBeFocused();
  await page.keyboard.press("End");
  await expect(tab("Settings")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(tab("pi-hole")).toBeFocused();
  // Moving does not open: Settings is still the open tab, until Enter.
  await expect(page.getByRole("tab", { selected: true })).toContainText("Settings");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { selected: true })).toContainText("pi-hole");
});

test("an icon button shows its name in a tooltip when it gets the focus", async ({ page }) => {
  await page.getByRole("button", { name: /^nas/ }).first().click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Open in SFTP" }).click();
  const up = page.getByRole("region", { name: "nas", exact: true }).getByRole("button", {
    name: "Parent folder",
  });
  await up.focus();
  await expect(page.getByRole("tooltip")).toHaveText("Parent folder");
  await expectSaneUi(page);
});

test("F1 lists the keys of lists and files", async ({ page }) => {
  await page.keyboard.press("F1");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Lists and files" })).toBeVisible();
  await expect(dialog).toContainText("Open the menu of the item");
  await expect(dialog).toContainText("Rename a file");
  await expectSaneUi(page);
});
