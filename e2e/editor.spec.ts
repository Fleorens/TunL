import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

function editor(page: Page) {
  return page.getByRole("dialog");
}

function field(page: Page, label: string) {
  return editor(page).getByLabel(label, { exact: true });
}

async function openEdit(page: Page, name: string) {
  await page
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .first()
    .click({ button: "right" });
  await page.getByRole("menu").getByText("Edit", { exact: true }).click();
}

test("creating a connection from the keyboard shortcut", async ({ page }) => {
  await page.keyboard.press("Control+Shift+N");
  await expect(editor(page).getByRole("heading", { name: "New connection" })).toBeVisible();
  await field(page, "Name").fill("staging");
  await field(page, "Host").fill("10.1.1.1");
  await editor(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor(page)).toHaveCount(0);
  const ungrouped = page.getByRole("region", { name: "Ungrouped", exact: true });
  await expect(ungrouped.getByRole("button", { name: /^staging/ })).toBeVisible();
});

test("Save stays disabled until the form is valid", async ({ page }) => {
  await page.getByRole("button", { name: "New", exact: true }).click();
  const save = editor(page).getByRole("button", { name: "Save", exact: true });
  await expect(save).toBeDisabled();
  await field(page, "Name").fill("x");
  await field(page, "Host").fill("bad host");
  await expect(editor(page).getByText("Enter a host name or an IP address")).toBeVisible();
  await expect(save).toBeDisabled();
  await field(page, "Host").fill("good.host");
  await expect(save).toBeEnabled();
});

test("the port follows the protocol until the user edits it", async ({ page }) => {
  await page.keyboard.press("Control+Shift+N");
  const port = field(page, "Port");
  await expect(port).toHaveValue("22");
  await editor(page).getByRole("radio", { name: "RDP", exact: true }).click();
  await expect(port).toHaveValue("3389");
  await port.fill("3390");
  await editor(page).getByRole("radio", { name: "SSH", exact: true }).click();
  await expect(port).toHaveValue("3390");
});

test("editing from the context menu, saved with Ctrl+S", async ({ page }) => {
  await openEdit(page, "pi-hole");
  await expect(editor(page).getByRole("heading", { name: "Edit pi-hole" })).toBeVisible();
  await expect(field(page, "Name")).toHaveValue("pi-hole");
  await field(page, "Name").fill("pi-dns");
  await page.keyboard.press("Control+s");
  await expect(editor(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^pi-dns/ }).first()).toBeVisible();
});

test("closing with unsaved changes asks first", async ({ page }) => {
  await page.keyboard.press("Control+Shift+N");
  await field(page, "Name").fill("draft");
  await page.keyboard.press("Escape");
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("Discard changes?");
  await confirm.getByRole("button", { name: "Keep editing" }).click();
  await expect(field(page, "Name")).toHaveValue("draft");
  await page.keyboard.press("Escape");
  await page.getByRole("alertdialog").getByRole("button", { name: "Discard" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("deleting from the editor", async ({ page }) => {
  await openEdit(page, "media-server");
  await editor(page).getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^media-server/ })).toHaveCount(0);
});

test("SSH key authentication needs a usable path", async ({ page }) => {
  await page.keyboard.press("Control+Shift+N");
  await field(page, "Name").fill("keyed");
  await field(page, "Host").fill("10.2.2.2");
  await editor(page).getByRole("tab", { name: "Authentication" }).click();
  await editor(page).getByRole("radio", { name: "Private key", exact: true }).click();
  await field(page, "Key path").fill("id_rsa");
  await expect(
    editor(page).getByText("Use an absolute path or one starting with ~/"),
  ).toBeVisible();
  await field(page, "Key path").fill("~/.ssh/id_ed25519");
  await editor(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: /^keyed/ }).first()).toBeVisible();
});
