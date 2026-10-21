import { expect, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("right-clicking a connection opens its menu, with the groups submenu", async ({ page }) => {
  await page
    .getByRole("button", { name: /^web-01/ })
    .first()
    .click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Connect" })).toBeVisible();
  await menu.getByRole("menuitem", { name: "Move to group" }).hover();
  await expect(page.getByRole("menuitem", { name: "Homelab" })).toBeVisible();
});

test("only one connection row is highlighted at a time", async ({ page }) => {
  await page.getByRole("button", { name: /^nas/ }).first().click();
  await page
    .getByRole("button", { name: /^pi-hole/ })
    .first()
    .click();
  const current = page.locator('[aria-current="true"]');
  await expect(current).toHaveCount(1);
  await expect(current).toContainText("pi-hole");
});

test("placeholder actions show a translated toast, never a raw key", async ({ page }) => {
  // T31: Settings is a real tab now; a quick RDP connection is still to come.
  await page.keyboard.press("Control+Shift+P");
  await page.getByRole("dialog").getByRole("combobox").fill("rdp://win-02");
  await page.getByRole("option", { name: "RDP to win-02" }).click();
  await expect(page.getByText("Coming soon")).toBeVisible();
  await expect(page.getByText("shell.notYetAvailable")).toHaveCount(0);
});

test("keyboard shortcuts drive the tabs and the sidebar filter", async ({ page }) => {
  await page.getByRole("button", { name: /^nas/ }).first().dblclick();
  await page
    .getByRole("button", { name: /^pi-hole/ })
    .first()
    .dblclick();
  await expect(page.getByRole("tab", { selected: true })).toContainText("pi-hole");
  await page.keyboard.press("Alt+Digit1");
  await expect(page.getByRole("tab", { selected: true })).toContainText("nas");
  await page.keyboard.press("Control+PageDown");
  await expect(page.getByRole("tab", { selected: true })).toContainText("pi-hole");

  await page.keyboard.press("Control+Shift+E");
  await expect(page.locator("#sidebar-filter")).toBeFocused();
  await page.keyboard.type("pg");
  await expect(page.getByRole("button", { name: /^db-prod/ })).toHaveCount(1);
});

test("the app starts on the home screen, and closing the last tab returns to it", async ({
  page,
}) => {
  await expect(page.getByRole("tab")).toHaveCount(0);
  const quickConnect = page.getByPlaceholder("user@host[:port] — quick connect");
  await quickConnect.fill("root@unreachable.test");
  await quickConnect.press("Enter");
  await expect(page.getByRole("tab")).toHaveCount(1);
  await page.keyboard.press("Control+Shift+W");
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("outside Tauri, the status bar flags the mock backend", async ({ page }) => {
  await expect(page.getByText("Mock backend")).toBeVisible();
  await expect(page.getByText("v0.1.0-mock")).toBeVisible();
});
