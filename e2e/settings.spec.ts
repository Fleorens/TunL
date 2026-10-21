// T31: the Settings tab — opened from the gear, Ctrl+, or the palette; every change applies at once.
import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

function settings(page: Page) {
  return page.getByRole("region", { name: "Settings", exact: true });
}

async function openSection(page: Page, name: string) {
  await settings(page).getByRole("navigation").getByRole("button", { name }).click();
}

async function choose(page: Page, label: string, option: string) {
  await settings(page).getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("the gear opens the Settings tab, its close button brings the home back", async ({ page }) => {
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
  const tab = page.getByRole("tab", { name: /Settings/ });
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(settings(page).getByRole("heading", { name: "Appearance" })).toBeVisible();
  await expectSaneUi(page);

  // A second open goes to the same tab.
  await page.keyboard.press("Control+,");
  await expect(page.getByRole("tab", { name: /Settings/ })).toHaveCount(1);

  await tab.getByRole("button", { name: "Close Settings" }).click();
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: /Good (morning|afternoon|evening)/ }),
  ).toBeVisible();
});

test("Ctrl+, and the palette open it too, beside the session tabs", async ({ page }) => {
  await page.getByRole("button", { name: /^nas/ }).first().dblclick();
  await expect(page.getByRole("tab", { selected: true })).toContainText("nas");
  await page.keyboard.press("Control+,");
  await expect(page.getByRole("tab", { selected: true })).toContainText("Settings");
  await expect(page.getByRole("region", { name: "nas", exact: true })).toBeHidden();

  // The next-tab shortcut walks the whole row, Settings included.
  await page.keyboard.press("Control+PageDown");
  await expect(page.getByRole("tab", { selected: true })).toContainText("nas");

  await page
    .getByRole("tab", { name: /Settings/ })
    .getByRole("button", { name: "Close Settings" })
    .click();
  await page.keyboard.press("Control+Shift+P");
  await page.getByRole("option", { name: /Settings/ }).click();
  await expect(page.getByRole("tab", { selected: true })).toContainText("Settings");
});

test("theme and language apply at once", async ({ page }) => {
  await page.keyboard.press("Control+,");
  await choose(page, "Theme", "Light");
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
  await choose(page, "Theme", "Dark");
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);

  await choose(page, "Language", "Français");
  const french = page.getByRole("region", { name: "Paramètres", exact: true });
  await expect(french.getByRole("heading", { name: "Apparence" })).toBeVisible();
  await expectSaneUi(page);
  await french.getByRole("combobox", { name: "Langue" }).click();
  await page.getByRole("option", { name: "English", exact: true }).click();
  await expect(settings(page).getByRole("heading", { name: "Appearance" })).toBeVisible();
});

test("the terminal settings reach an open terminal", async ({ page }) => {
  await page.getByRole("button", { name: /^nas/ }).first().dblclick();
  const rows = page.getByRole("region", { name: "nas", exact: true }).locator(".xterm-rows");
  await expect(rows).toContainText("nas");
  await page.keyboard.press("Control+,");
  await openSection(page, "Terminal");
  await expectSaneUi(page);
  await choose(page, "Font size", "18 px");

  await page.getByRole("tab", { name: /nas/ }).click();
  await expect(rows).toHaveCSS("font-size", "18px");
});

test("a font name the backend would refuse is not saved", async ({ page }) => {
  await page.keyboard.press("Control+,");
  await openSection(page, "Terminal");
  const font = settings(page).getByLabel("Font", { exact: true });
  await expect(font).toHaveValue("Geist Mono Variable");
  await font.fill("   ");
  await font.press("Enter");
  await expect(font).toHaveAttribute("aria-invalid", "true");
  await expect(settings(page)).toContainText("Between 1 and 64 characters.");
});

test("turning the probes off leaves every dot unknown and hides the interval", async ({ page }) => {
  const nas = page.getByRole("complementary").getByRole("button", { name: /^nas/ }).first();
  await expect(nas.getByRole("img", { name: "Online" })).toBeVisible();
  await page.keyboard.press("Control+,");
  await openSection(page, "Availability");
  await expect(settings(page).getByRole("combobox", { name: "Check every" })).toBeVisible();
  await expectSaneUi(page);

  await settings(page).getByRole("switch", { name: "Check which machines are reachable" }).click();
  await expect(nas.getByRole("img", { name: "Unknown" })).toBeVisible();
  await expect(settings(page).getByRole("combobox", { name: "Check every" })).toHaveCount(0);
});

test("About shows the version, the licence and TunL's folders", async ({ page }) => {
  await page.keyboard.press("Control+,");
  await openSection(page, "About");
  await expect(settings(page)).toContainText("Version 0.1.0-mock");
  await expect(settings(page)).toContainText("GPL-3.0-or-later");
  await expect(settings(page)).toContainText("~/.config/io.github.fleorens.TunL");
  await expect(settings(page).getByRole("button", { name: "Configuration folder" })).toBeVisible();
  await expect(settings(page).getByRole("button", { name: "Source code" })).toBeVisible();
  await expectSaneUi(page);
});
