// T21: terminal tabs over the mock sessions of T19 (nas, pi-hole: direct; web-01: behind bastion-01).
import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

async function open(page: Page, name: string) {
  await page
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .first()
    .dblclick();
}

function view(page: Page, title: string) {
  return page.getByRole("region", { name: title, exact: true });
}

function screen(page: Page, title: string) {
  return view(page, title).locator(".xterm-rows");
}

async function typeLine(page: Page, title: string, line: string) {
  await view(page, title).locator("[data-terminal]").click();
  await page.keyboard.type(line);
  await page.keyboard.press("Enter");
}

function activeTab(page: Page) {
  return page.getByRole("tab", { selected: true });
}

test("double-clicking a connection opens a terminal that connects", async ({ page }) => {
  await open(page, "nas");
  await expect(activeTab(page)).toContainText("nas");
  await expect(screen(page, "nas")).toContainText("Welcome to nas");
  await expect(screen(page, "nas")).toContainText("admin@192.168.1.10:~$");
  await expect(activeTab(page).getByRole("img", { name: "Online" })).toBeVisible();
});

test("the connecting overlay lists the steps, the bastion first", async ({ page }) => {
  await open(page, "web-01");
  const overlay = view(page, "web-01").getByRole("status");
  await expect(overlay).toContainText("Connecting to web-01");
  await expect(overlay).toContainText("Through bastion-01");
  await expect(screen(page, "web-01")).toContainText("Welcome to web-01");
  await expect(overlay).toHaveCount(0);
});

test("the shell runs commands; exit shows the end banner and Reconnect starts again", async ({
  page,
}) => {
  await open(page, "nas");
  await expect(screen(page, "nas")).toContainText("Welcome to nas");
  await typeLine(page, "nas", "echo ok-42");
  await expect(screen(page, "nas")).toContainText(/echo ok-42\s*ok-42/);

  await typeLine(page, "nas", "exit 2");
  const banner = view(page, "nas").getByText("Session ended (exit code 2)");
  await expect(banner).toBeVisible();
  await expect(activeTab(page).getByRole("img", { name: "Offline" })).toBeVisible();
  await expectSaneUi(page);

  await view(page, "nas").getByRole("button", { name: "Reconnect" }).click();
  await expect(banner).toHaveCount(0);
  await expect(activeTab(page).getByRole("img", { name: "Online" })).toBeVisible();
});

test("a connection opened twice gets a numbered tab; Alt+n switches and keeps each screen", async ({
  page,
}) => {
  await open(page, "nas");
  await expect(screen(page, "nas")).toContainText("Welcome to nas");
  await open(page, "nas");
  await expect(activeTab(page)).toContainText("nas (2)");
  await expect(screen(page, "nas (2)")).toContainText("Welcome to nas");
  await open(page, "pi-hole");
  await expect(screen(page, "pi-hole")).toContainText("pi@192.168.1.2:~$");

  await page.keyboard.press("Alt+Digit1");
  await expect(view(page, "nas")).toBeVisible();
  await expect(view(page, "pi-hole")).toBeHidden();
  await expect(screen(page, "nas")).toContainText("Welcome to nas");
  await page.keyboard.press("Alt+Digit9");
  await expect(activeTab(page)).toContainText("pi-hole");
});

test("an unreachable quick connection shows an error card with Retry", async ({ page }) => {
  await page.keyboard.press("Control+Shift+T");
  await page.getByRole("dialog").getByRole("combobox").fill("root@unreachable.test");
  await page.keyboard.press("Enter");

  const card = view(page, "root@unreachable.test").getByRole("alert");
  await expect(card).toContainText("Connection failed");
  await expect(card.getByRole("button", { name: "Edit connection" })).toHaveCount(0);
  await expectSaneUi(page);
  await card.getByRole("button", { name: "Details" }).click();
  await expect(card).toContainText("unreachable.test:22");

  await card.getByRole("button", { name: "Retry" }).click();
  await expect(card).toContainText("Connection failed");
  await expect(activeTab(page).getByRole("img", { name: "Error" })).toBeVisible();
});

test("closing a connected session asks first; the last tab closed shows the home screen", async ({
  page,
}) => {
  await open(page, "nas");
  await expect(screen(page, "nas")).toContainText("Welcome to nas");
  await page.keyboard.press("Control+Shift+W");
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("Close nas?");
  await confirm.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("a session that is not connected closes without a question", async ({ page }) => {
  await page.keyboard.press("Control+Shift+T");
  await page.getByRole("dialog").getByRole("combobox").fill("root@unreachable.test");
  await page.keyboard.press("Enter");
  await expect(view(page, "root@unreachable.test").getByRole("alert")).toBeVisible();
  await activeTab(page).getByRole("button", { name: "Close root@unreachable.test" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(0);
});

test("the status bar shows the session's address, its size and the active count", async ({
  page,
}) => {
  await open(page, "nas");
  await expect(screen(page, "nas")).toContainText("Welcome to nas");
  const footer = page.getByRole("contentinfo");
  await expect(footer).toContainText("admin@192.168.1.10:22");
  await expect(footer).toContainText(/\d+×\d+/);
  await expect(footer).toContainText("1 active session");
});

test("app shortcuts still work while the terminal has the focus", async ({ page }) => {
  await open(page, "nas");
  await expect(screen(page, "nas")).toContainText("Welcome to nas");
  await view(page, "nas").locator("[data-terminal]").click();
  await page.keyboard.press("Control+Shift+P");
  await expect(page.getByRole("dialog").getByRole("combobox")).toBeFocused();
});

test("the sidebar's Connect opens a session, a terminal for SSH, a card for RDP", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: /^pi-hole/ })
    .first()
    .click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Connect" }).click();
  await expect(screen(page, "pi-hole")).toContainText("Welcome to pi-hole");

  await page
    .getByRole("button", { name: /^ad-01/ })
    .first()
    .click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Connect" }).click();
  await expect(page.getByRole("region", { name: "Remote desktop ad-01" })).toBeVisible();
});
