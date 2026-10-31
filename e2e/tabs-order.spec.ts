// T59: tabs move with the keyboard or the mouse, duplicate, and close in groups with one confirmation.
// Mock: nas, pi-hole and web-01 connect without a question.
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  for (const name of ["nas", "pi-hole", "web-01"]) {
    await page
      .getByRole("button", { name: new RegExp(`^${name}`) })
      .first()
      .dblclick();
    await expect(page.getByRole("tab", { selected: true })).toContainText(name);
    await expect(
      page.getByRole("region", { name, exact: true }).locator(".xterm-rows"),
    ).toContainText(`Welcome to ${name}`);
  }
  await expect(page.getByRole("tab").last()).toContainText("web-01");
});

function titles(page: Page) {
  return page.getByRole("tab");
}

test("Ctrl+Shift+PgUp moves the active tab, without wrapping", async ({ page }) => {
  await page.keyboard.press("Control+Shift+PageUp");
  await expect(titles(page)).toHaveText([/nas/, /web-01/, /pi-hole/]);
  await page.keyboard.press("Control+Shift+PageUp");
  await page.keyboard.press("Control+Shift+PageUp");
  await expect(titles(page)).toHaveText([/web-01/, /nas/, /pi-hole/]);
  await expect(page.getByRole("tab", { selected: true })).toContainText("web-01");
});

test("a tab dragged onto another takes its place", async ({ page }) => {
  const from = await titles(page).nth(2).boundingBox();
  const to = await titles(page).nth(0).boundingBox();
  if (!from || !to) throw new Error("the tabs have no box");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 10, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(titles(page).first()).toContainText("web-01");
});

test("Duplicate opens the same connection in a new tab", async ({ page }) => {
  await page.getByRole("tab", { name: /nas/ }).click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Duplicate" }).click();
  await expect(titles(page)).toHaveCount(4);
  await expect(page.getByRole("tab", { selected: true })).toContainText("nas (2)");
});

test("Close other tabs asks once for every connected tab", async ({ page }) => {
  await page.getByRole("tab", { name: /pi-hole/ }).click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Close other tabs" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Close 2 connected tabs?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(titles(page)).toHaveCount(3);

  await page.getByRole("tab", { name: /pi-hole/ }).click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Close other tabs" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: /^Close/ })
    .click();
  await expect(titles(page)).toHaveCount(1);
  await expect(titles(page)).toContainText("pi-hole");
});

test("Close tabs to the right keeps the tab and those before it", async ({ page }) => {
  await page.getByRole("tab", { name: /nas/ }).click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Close tabs to the right" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: /^Close/ })
    .click();
  await expect(titles(page)).toHaveCount(1);
  await expect(titles(page)).toContainText("nas");
});
