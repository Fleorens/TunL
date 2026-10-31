// T60: the tabs of last time are offered on the home screen, then reopened in the same order.
// Mock: a reload of the page plays a restart; "Reopen tabs at startup" is "Ask".
import { expect, test } from "./support/test.ts";

test("after a restart, the home screen offers to reopen the tabs, in order", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^nas/ }).first().dblclick();
  await page
    .getByRole("button", { name: /^pi-hole/ })
    .first()
    .dblclick();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await page.waitForTimeout(800);

  await page.reload();
  await expect(page.getByRole("tab")).toHaveCount(0);
  await page.getByRole("button", { name: "Reopen 2 tabs" }).click();
  await expect(page.getByRole("tab")).toHaveText([/nas/, /pi-hole/]);
  await expect(page.getByRole("button", { name: "Reopen 2 tabs" })).toHaveCount(0);
});

test("a quick connection is never kept, and Dismiss hides the offer", async ({ page }) => {
  await page.goto("/");
  const quick = page.getByPlaceholder("user@host[:port] — quick connect");
  await quick.fill("root@unreachable.test");
  await quick.press("Enter");
  await page.getByRole("button", { name: /^nas/ }).first().dblclick();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await page.waitForTimeout(800);

  await page.reload();
  await expect(page.getByRole("button", { name: "Reopen 1 tab" })).toBeVisible();
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByRole("button", { name: /^Reopen/ })).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(0);
});

test("the setting lists Never, Ask and Always", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Control+,");
  const settings = page.getByRole("region", { name: "Settings", exact: true });
  await settings.getByRole("combobox", { name: "Reopen tabs at startup" }).click();
  for (const option of ["Never", "Ask", "Always"]) {
    await expect(page.getByRole("option", { name: option, exact: true })).toBeVisible();
  }
});
