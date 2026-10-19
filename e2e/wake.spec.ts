// T29: Wake-on-LAN from the menu, and before connecting (mock: win-desktop has Wake-on-LAN).
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

function editor(page: Page) {
  return page.getByRole("dialog");
}

function row(page: Page, name: string) {
  return page.getByRole("button", { name: new RegExp(`^${name}`) }).first();
}

test("the menu's Wake up sends the magic packet and says so", async ({ page }) => {
  await row(page, "win-desktop").click({ button: "right" });
  await page.getByRole("menu").getByText("Wake up", { exact: true }).click();
  await expect(page.getByText("Magic packet sent to win-desktop")).toBeVisible();
});

test("a connection set to wake before connecting shows the Wake step first", async ({ page }) => {
  await row(page, "nas").click({ button: "right" });
  await page.getByRole("menu").getByText("Edit", { exact: true }).click();
  await editor(page).getByRole("tab", { name: "Network" }).click();
  await editor(page).getByRole("switch", { name: "Wake-on-LAN" }).click();
  await editor(page).getByLabel("MAC address", { exact: true }).fill("aa:bb:cc:dd:ee:ff");
  await editor(page).getByRole("switch", { name: "Wake before connecting" }).click();
  await editor(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor(page)).toHaveCount(0);

  await row(page, "nas").dblclick();
  const view = page.getByRole("region", { name: "nas", exact: true });
  await expect(view.getByRole("status")).toContainText("Waking up nas");
  await expect(view.locator(".xterm-rows")).toContainText("Welcome to nas");
});
