// T21b: what the user answers while connecting (mock scenarios: db-prod, router, media-server, kiosk-01).
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

test("a first connection asks to trust the host key, then remembers it", async ({ page }) => {
  await open(page, "db-prod");
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("First connection to db.internal:22");
  await expect(dialog).toContainText("ssh-ed25519");
  await expect(dialog).toContainText(/SHA256:\S+/);
  await expectSaneUi(page);
  await dialog.getByRole("button", { name: "Trust and continue" }).click();
  await expect(screen(page, "db-prod")).toContainText("Welcome to db-prod");

  await open(page, "db-prod");
  await expect(screen(page, "db-prod (2)")).toContainText("Welcome to db-prod");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});

test("refusing the host key stops the connection", async ({ page }) => {
  await open(page, "db-prod");
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  await expect(view(page, "db-prod").getByRole("alert")).toContainText("Host key rejected");
});

test("a wrong password asks again; a remembered one is not asked any more", async ({ page }) => {
  await open(page, "router");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Password for root@192.168.1.1");
  const field = dialog.getByLabel("Password", { exact: true });
  await expect(field).toHaveAttribute("type", "password");
  await dialog.getByRole("button", { name: "Show password" }).click();
  await expect(field).toHaveAttribute("type", "text");
  await expect(dialog.getByRole("button", { name: "Connect" })).toBeDisabled();
  await field.fill("wrong");
  await dialog.getByRole("button", { name: "Connect" }).click();

  await expect(dialog).toContainText("Wrong password, try again.");
  await field.fill("right");
  await dialog.getByRole("checkbox", { name: "Remember in the keyring" }).click();
  await expectSaneUi(page);
  await dialog.getByRole("button", { name: "Connect" }).click();
  await expect(screen(page, "router")).toContainText("Welcome to router");

  await open(page, "router");
  await expect(screen(page, "router (2)")).toContainText("Welcome to router");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("cancelling a password prompt ends the attempt; Retry asks again", async ({ page }) => {
  await open(page, "router");
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  const card = view(page, "router").getByRole("alert");
  await expect(card).toContainText("Cancelled");
  await card.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("dialog")).toContainText("Password for root@192.168.1.1");
});

test("keyboard-interactive shows every question, masking the secret ones", async ({ page }) => {
  await open(page, "media-server");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Two-factor authentication");
  const password = dialog.getByLabel("Password:");
  const code = dialog.getByLabel("Verification code:");
  await expect(password).toHaveAttribute("type", "password");
  await expect(code).toHaveAttribute("type", "text");
  await expectSaneUi(page);
  await password.fill("secret");
  await code.fill("123456");
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(screen(page, "media-server")).toContainText("Welcome to media-server");
});

test("closing the tab withdraws its prompt", async ({ page }) => {
  await open(page, "db-prod");
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.keyboard.press("Control+Shift+W");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(0);
});

test("a changed host key is explained, and the old key can be removed", async ({ page }) => {
  await open(page, "kiosk-01");
  const card = view(page, "kiosk-01").getByRole("alert");
  await expect(card).toContainText("The host key of kiosk-01 has changed");
  await expect(card).toContainText("SHA256:oldKiosk");
  await expect(card).toContainText("SHA256:newKiosk");
  await expectSaneUi(page);

  await card.getByRole("button", { name: "Remove the old key…" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Remove the old key of 172.16.0.40?" });
  const remove = confirm.getByRole("button", { name: "Remove the key" });
  await expect(remove).toBeDisabled();
  await confirm.getByRole("textbox").fill("172.16.0.4");
  await expect(remove).toBeDisabled();
  await confirm.getByRole("textbox").fill("172.16.0.40");
  await remove.click();
  await expect(page.getByText("Old key removed")).toBeVisible();

  // The session starts again: the server is now unknown, so TunL asks.
  await expect(confirm).toHaveCount(0);
  const trust = page.getByRole("alertdialog", { name: "First connection to 172.16.0.40:22" });
  await expect(trust).toBeVisible();
  await trust.getByRole("button", { name: "Trust and continue" }).click();
  await expect(screen(page, "kiosk-01")).toContainText("Welcome to kiosk-01");
});
