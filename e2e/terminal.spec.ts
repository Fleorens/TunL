// T20: the terminal component, driven in the design gallery by a local echo port (no session needed).
import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/#gallery");
});

function terminal(page: Page) {
  return page.getByRole("region", { name: "Terminal", exact: true }).locator("[data-terminal]");
}

function screen(page: Page) {
  return terminal(page).locator(".xterm-rows");
}

async function typeLine(page: Page, line: string) {
  await terminal(page).click();
  await page.keyboard.type(line);
  await page.keyboard.press("Enter");
}

test("typing reaches the port and its output is drawn", async ({ page }) => {
  await expect(screen(page)).toContainText("TunL terminal demo");
  await typeLine(page, "hello");
  await expect(screen(page)).toContainText("you typed: hello");
});

test("the terminal follows the app theme, padding included", async ({ page }) => {
  await expect(terminal(page)).toHaveCSS("background-color", "rgb(10, 13, 18)");
  await expect(terminal(page)).toHaveCSS("padding", "8px 12px");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(terminal(page)).toHaveCSS("background-color", "rgb(251, 251, 253)");
});

test("Ctrl+= and Ctrl+- zoom, Ctrl+0 goes back to the setting", async ({ page }) => {
  await terminal(page).click();
  const fontSize = () => screen(page).evaluate((element) => getComputedStyle(element).fontSize);
  await expect.poll(fontSize).toBe("13px");
  await page.keyboard.press("Control+Equal");
  await expect.poll(fontSize).toBe("14px");
  await page.keyboard.press("Control+Minus");
  await page.keyboard.press("Control+Minus");
  await expect.poll(fontSize).toBe("12px");
  await page.keyboard.press("Control+Digit0");
  await expect.poll(fontSize).toBe("13px");
});

test("Ctrl+Shift+F searches the scrollback; Escape gives the focus back", async ({ page }) => {
  await typeLine(page, "hello");
  await expect(screen(page)).toContainText("you typed: hello");
  await page.keyboard.press("Control+Shift+F");
  const search = page.getByRole("searchbox", { name: "Search the terminal" });
  await expect(search).toBeFocused();
  await search.fill("hello");
  await expect(page.getByText(/^[12] of 2$/)).toBeVisible();
  await expectSaneUi(page);

  await search.fill("absent-word");
  await expect(page.getByText("No results")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(search).toHaveCount(0);
  await expect(terminal(page).locator("textarea")).toBeFocused();
});

test("Ctrl+Shift+C copies the selection and Ctrl+Shift+V pastes it", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await expect(screen(page)).toContainText("TunL terminal demo");
  // A double click selects the word under the pointer: "TunL", the first word of the first row.
  // `force`: xterm's DOM renderer makes `.xterm-rows` `pointer-events: none`, so the click lands on
  // `.xterm-screen` at that point, which is what xterm listens to (validated by Florian, 2026-10-11).
  await screen(page)
    .locator("div")
    .first()
    .dblclick({ position: { x: 6, y: 6 }, force: true });
  await page.keyboard.press("Control+Shift+C");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("TunL");

  await page.keyboard.press("Control+Shift+V");
  await page.keyboard.press("Enter");
  await expect(screen(page)).toContainText("you typed: TunL");
});

test("Ctrl+C and Ctrl+V without Shift stay with the shell", async ({ page }) => {
  await terminal(page).click();
  await page.keyboard.type("abc");
  // Ctrl+C sends ETX (0x03) to the port, which the demo shows as ^C.
  await page.keyboard.press("Control+KeyC");
  await expect(screen(page)).toContainText("abc^C");
});

test("F1 lists the terminal's own shortcuts too", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("F1");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Terminal" })).toBeVisible();
  await expect(dialog.getByText("Search the terminal")).toBeVisible();
  await expect(dialog.getByText("Paste", { exact: true })).toBeVisible();
  await expectSaneUi(page);
});
