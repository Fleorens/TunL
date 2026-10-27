// T44: the editor saves once, opens on the Name field, and offers "Multiple monitors" in full screen only.
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

function editor(page: Page) {
  return page.getByRole("dialog");
}

test("a double click on Save creates one connection", async ({ page }) => {
  await page.keyboard.press("Control+Shift+N");
  await editor(page).getByRole("textbox", { name: /^Name/ }).fill("once-01");
  await editor(page).getByRole("textbox", { name: /^Host/ }).fill("10.9.9.9");
  await editor(page).getByRole("button", { name: "Save" }).dblclick();
  await expect(editor(page)).toHaveCount(0);
  await expect(
    page.getByRole("complementary").locator("[data-sidebar-row]", { hasText: "once-01" }),
  ).toHaveCount(1);
});

test("a new connection opens on the Name field", async ({ page }) => {
  await page.keyboard.press("Control+Shift+N");
  await expect(editor(page).getByRole("textbox", { name: /^Name/ })).toBeFocused();
});

test("Multiple monitors is only offered in full screen", async ({ page }) => {
  await page.keyboard.press("Control+Shift+N");
  await editor(page).getByRole("radio", { name: "RDP", exact: true }).click();
  await editor(page).getByRole("tab", { name: "Advanced" }).click();
  const multimon = editor(page).getByRole("switch", { name: "Multiple monitors" });
  await expect(multimon).toBeDisabled();
  await editor(page).getByRole("radio", { name: "Full screen" }).click();
  await expect(multimon).toBeEnabled();
});
