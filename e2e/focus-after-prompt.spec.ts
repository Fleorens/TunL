// T30b: once a password or 2FA dialog is answered and the session opens, the keyboard goes to the terminal.
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

function terminal(page: Page, title: string) {
  return page.getByRole("region", { name: title, exact: true });
}

test("after the password dialog, typing goes to the terminal", async ({ page }) => {
  await page
    .getByRole("button", { name: /^router/ })
    .first()
    .dblclick();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Password", { exact: true }).fill("right");
  await dialog.getByRole("button", { name: "Connect" }).click();

  await expect(page.getByRole("tab", { selected: true })).toContainText("router");
  await expect(terminal(page, "router").locator(".xterm-helper-textarea")).toBeFocused();
});

test("after the 2FA dialog, typing goes to the terminal", async ({ page }) => {
  await page
    .getByRole("button", { name: /^media-server/ })
    .first()
    .dblclick();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Password:").fill("secret");
  await dialog.getByLabel("Verification code:").fill("123456");
  await dialog.getByRole("button", { name: "Continue" }).click();

  await expect(terminal(page, "media-server").locator(".xterm-helper-textarea")).toBeFocused();
});
