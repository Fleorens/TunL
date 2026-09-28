import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

function palette(page: Page) {
  return page.getByRole("dialog");
}

test("the palette finds a connection by host, and Alt+Enter edits it", async ({ page }) => {
  await page.keyboard.press("Control+Shift+P");
  await palette(page).getByRole("combobox").fill("10.0.0.12");
  await expect(palette(page).getByRole("option", { name: /web-01/ })).toBeVisible();
  await expectSaneUi(page);
  await page.keyboard.press("Alt+Enter");
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: "Edit web-01" }),
  ).toBeVisible();
});

test("Enter on a connection opens it (sessions come later)", async ({ page }) => {
  await page.getByRole("button", { name: /Search or connect/ }).click();
  await palette(page).getByRole("combobox").fill("db-prod");
  await page.keyboard.press("Enter");
  await expect(palette(page)).toHaveCount(0);
  await expect(page.getByText("Coming soon")).toBeVisible();
});

test("quick connect can be saved as a new connection", async ({ page }) => {
  await page.keyboard.press("Control+Shift+T");
  await palette(page).getByRole("combobox").fill("deploy@10.5.5.5:2222");
  await expect(
    palette(page).getByRole("option", { name: "SSH to deploy@10.5.5.5:2222" }),
  ).toBeVisible();
  await palette(page).getByRole("option", { name: "Save as a new connection…" }).click();
  const editor = page.getByRole("dialog");
  await expect(editor.getByRole("heading", { name: "New connection" })).toBeVisible();
  await expect(editor.getByLabel("Host", { exact: true })).toHaveValue("10.5.5.5");
  await expect(editor.getByLabel("Port", { exact: true })).toHaveValue("2222");
  await expect(editor.getByLabel("Username", { exact: true })).toHaveValue("deploy");
  await expect(editor.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
});

test("rdp:// switches the quick connect protocol", async ({ page }) => {
  await page.keyboard.press("Control+Shift+P");
  await palette(page).getByRole("combobox").fill("rdp://win-02");
  await expect(palette(page).getByRole("option", { name: "RDP to win-02" })).toBeVisible();
});

test("F1 lists the keyboard shortcuts", async ({ page }) => {
  await page.keyboard.press("F1");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Keyboard shortcuts" })).toBeVisible();
  await expect(dialog.getByText("Command palette")).toBeVisible();
  await expect(dialog.getByText("Go to tab 1…8")).toBeVisible();
  await expectSaneUi(page);
});
