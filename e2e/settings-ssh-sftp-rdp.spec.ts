// T31b: Settings › SSH (defaults, known hosts), SFTP (download folder) and RDP (FreeRDP client).
// Mock: three known hosts at start; the chooser picks /home/user/Transfers or /opt/freerdp/bin/sdl-freerdp3.
import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Control+,");
});

function settings(page: Page) {
  return page.getByRole("region", { name: "Settings", exact: true });
}

async function openSection(page: Page, name: string) {
  await settings(page).getByRole("navigation").getByRole("button", { name, exact: true }).click();
}

test("SSH defaults are saved at once", async ({ page }) => {
  await openSection(page, "SSH");
  const timeout = settings(page).getByRole("combobox", { name: "Connection timeout" });
  await expect(timeout).toHaveText("15 seconds");
  await expect(settings(page).getByRole("combobox", { name: "Keepalive" })).toHaveText(
    "30 seconds",
  );
  await expectSaneUi(page);

  await timeout.click();
  await page.getByRole("option", { name: "60 seconds", exact: true }).click();
  await openSection(page, "Terminal");
  await openSection(page, "SSH");
  await expect(timeout).toHaveText("60 seconds");
});

test("a known host can be forgotten, after a confirmation", async ({ page }) => {
  await openSection(page, "SSH");
  const hosts = settings(page).getByRole("list", { name: "Known hosts" });
  await expect(hosts.getByRole("listitem")).toHaveCount(3);
  await expect(hosts.getByRole("listitem", { name: "192.168.1.2" })).toContainText(
    "ecdsa-sha2-nistp256",
  );

  await hosts.getByRole("button", { name: "Forget 192.168.1.2" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("Forget the key of 192.168.1.2?");
  await expectSaneUi(page);
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(hosts.getByRole("listitem")).toHaveCount(3);

  await hosts.getByRole("button", { name: "Forget 192.168.1.2" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Forget" }).click();
  await expect(hosts.getByRole("listitem")).toHaveCount(2);
  await expect(hosts.getByRole("listitem", { name: "192.168.1.2" })).toHaveCount(0);
});

test("a host trusted while connecting shows up in the list", async ({ page }) => {
  await page
    .getByRole("button", { name: /^db-prod/ })
    .first()
    .dblclick();
  await page.getByRole("alertdialog").getByRole("button", { name: "Trust and continue" }).click();
  await page.getByRole("tab", { name: /Settings/ }).click();
  await openSection(page, "SSH");
  const hosts = settings(page).getByRole("list", { name: "Known hosts" });
  await expect(hosts.getByRole("listitem", { name: "db.internal" })).toBeVisible();
});

test("the download folder is the system one until another is chosen", async ({ page }) => {
  await openSection(page, "SFTP");
  await expect(settings(page)).toContainText("The system Downloads folder");
  await expectSaneUi(page);
  await settings(page).getByRole("button", { name: "Download folder" }).click();
  await expect(settings(page)).toContainText("/home/user/Transfers");
  await settings(page).getByRole("button", { name: "Use the system folder" }).click();
  await expect(settings(page)).toContainText("The system Downloads folder");
});

test("the RDP client found, then a program chosen by hand", async ({ page }) => {
  await openSection(page, "RDP");
  await expect(settings(page)).toContainText("/usr/bin/sdl-freerdp3 (version 3.10.3)");
  await expect(settings(page)).toContainText("Found automatically");
  await expectSaneUi(page);

  await settings(page).getByRole("button", { name: "Program" }).click();
  await expect(settings(page)).toContainText("/opt/freerdp/bin/sdl-freerdp3 (version 3.10.3)");
  await settings(page).getByRole("button", { name: "Find automatically" }).click();
  await expect(settings(page)).toContainText("/usr/bin/sdl-freerdp3 (version 3.10.3)");
});
