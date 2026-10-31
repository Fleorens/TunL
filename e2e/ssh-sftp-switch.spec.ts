// T58: a terminal tab opens its server in SFTP, and an SFTP folder opens a terminal already in it.
// Mock: nas's user is admin, its home holds projects; the mock shell echoes what it receives.
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

function region(page: Page, name: string) {
  return page.getByRole("region", { name, exact: true });
}

async function openTerminal(page: Page) {
  await page.getByRole("button", { name: /^nas/ }).first().dblclick();
  await expect(region(page, "nas").locator(".xterm-rows")).toContainText("Welcome to nas");
}

test("the menu of a terminal tab opens the same server in SFTP", async ({ page }) => {
  await openTerminal(page);
  await page.getByRole("tab", { name: /nas/ }).click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Open in SFTP" }).click();

  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.getByRole("tab", { selected: true })).toContainText("nas (2)");
  await expect(
    region(page, "nas (2)").getByRole("table", { name: "Files" }).locator("tbody tr").first(),
  ).toContainText("projects");
});

test("the palette offers Open in SFTP for the active terminal tab", async ({ page }) => {
  await openTerminal(page);
  await page.keyboard.press("Control+Shift+P");
  const palette = page.getByRole("dialog");
  await palette.getByRole("combobox").fill("sftp");
  await expect(
    palette.locator("[cmdk-group-heading]").filter({ hasText: /^Current tab$/ }),
  ).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { selected: true })).toContainText("nas (2)");
});

test("Open a terminal here starts the shell in the folder shown", async ({ page }) => {
  await page.getByRole("button", { name: /^nas/ }).first().click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Open in SFTP" }).click();
  const files = region(page, "nas").getByRole("table", { name: "Files" });
  await files
    .locator("tbody tr td:first-child")
    .filter({ hasText: /^projects$/ })
    .dblclick();
  await expect(files.locator("tbody tr").first()).toContainText("app");

  await region(page, "nas").getByRole("button", { name: "Open a terminal here" }).click();
  await expect(page.getByRole("tab", { selected: true })).toContainText("nas (2)");
  await expect(region(page, "nas (2)").locator(".xterm-rows")).toContainText(
    "cd '/home/admin/projects'",
  );
});
