// T35: the optional TunL title bar — off by default, chosen in Settings › Appearance, with its window buttons.
import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

function windowControls(page: Page) {
  return page.getByRole("banner").getByRole("group", { name: "Window controls" });
}

async function chooseTitleBar(page: Page, option: "System" | "TunL") {
  await page.keyboard.press("Control+,");
  const settings = page.getByRole("region", { name: "Settings", exact: true });
  await settings.getByRole("navigation").getByRole("button", { name: "Appearance" }).click();
  await settings.getByRole("combobox", { name: "Title bar" }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("the system title bar is the default: no window buttons in the app", async ({ page }) => {
  await expect(page.getByRole("banner").getByRole("button", { name: "Settings" })).toBeVisible();
  await expect(windowControls(page)).toHaveCount(0);
  await expect(page.getByRole("banner")).not.toHaveAttribute("data-tauri-drag-region");
});

test("the TunL title bar puts minimize, maximize and close in the top bar", async ({ page }) => {
  await chooseTitleBar(page, "TunL");
  const controls = windowControls(page);
  await expect(controls.getByRole("button", { name: "Minimize" })).toBeVisible();
  await expect(controls.getByRole("button", { name: "Maximize" })).toBeVisible();
  await expect(controls.getByRole("button", { name: "Close window" })).toBeVisible();
  await expect(page.getByRole("banner")).toHaveAttribute("data-tauri-drag-region");
  await expectSaneUi(page);

  await chooseTitleBar(page, "System");
  await expect(windowControls(page)).toHaveCount(0);
  await expect(page.getByRole("banner")).not.toHaveAttribute("data-tauri-drag-region");
});

test("maximize turns into restore, and back", async ({ page }) => {
  await chooseTitleBar(page, "TunL");
  const controls = windowControls(page);
  await controls.getByRole("button", { name: "Maximize" }).click();
  await expect(controls.getByRole("button", { name: "Restore" })).toBeVisible();
  await controls.getByRole("button", { name: "Restore" }).click();
  await expect(controls.getByRole("button", { name: "Maximize" })).toBeVisible();
});

test("the help under the setting gives the way back", async ({ page }) => {
  await chooseTitleBar(page, "TunL");
  await expect(page.getByRole("region", { name: "Settings", exact: true })).toContainText(
    "TUNL_TITLEBAR=native",
  );
});
