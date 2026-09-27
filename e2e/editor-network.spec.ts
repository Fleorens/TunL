import { expect, type Page, test } from "@playwright/test";

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

test("choosing a bastion shows the resulting chain", async ({ page }) => {
  await page.keyboard.press("Control+Shift+N");
  await field(page, "Name").fill("app-01");
  await field(page, "Host").fill("10.3.3.3");
  await editor(page).getByRole("tab", { name: "Network" }).click();
  await editor(page).getByRole("combobox", { name: "Jump host" }).click();
  await page.getByRole("option", { name: "bastion-01" }).click();
  await expect(editor(page).getByText("You → bastion-01 → app-01")).toBeVisible();
  await editor(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor(page)).toHaveCount(0);

  await openEdit(page, "app-01");
  await editor(page).getByRole("tab", { name: "Network" }).click();
  await expect(editor(page).getByRole("combobox", { name: "Jump host" })).toContainText(
    "bastion-01",
  );
});

test("Wake-on-LAN: the MAC address is normalized and the menu offers a wake-up", async ({
  page,
}) => {
  await page.getByRole("button", { name: /^nas/ }).first().click({ button: "right" });
  await expect(page.getByRole("menu").getByText("Wake up", { exact: true })).toHaveCount(0);
  await page.getByRole("menu").getByText("Edit", { exact: true }).click();
  await editor(page).getByRole("tab", { name: "Network" }).click();
  await editor(page).getByRole("switch", { name: "Wake-on-LAN" }).click();
  await field(page, "MAC address").fill("aa-bb-cc-dd-ee-ff");
  await editor(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor(page)).toHaveCount(0);

  await page.getByRole("button", { name: /^nas/ }).first().click({ button: "right" });
  await expect(page.getByRole("menu").getByText("Wake up", { exact: true })).toBeVisible();
  await page.getByRole("menu").getByText("Edit", { exact: true }).click();
  await editor(page).getByRole("tab", { name: "Network" }).click();
  await expect(field(page, "MAC address")).toHaveValue("AA:BB:CC:DD:EE:FF");
});

test("RDP advanced settings are validated", async ({ page }) => {
  await page.keyboard.press("Control+Shift+N");
  await editor(page).getByRole("radio", { name: "RDP", exact: true }).click();
  await field(page, "Name").fill("win-02");
  await field(page, "Host").fill("10.4.4.4");
  await editor(page).getByRole("tab", { name: "Advanced" }).click();
  await editor(page).getByRole("radio", { name: "Fixed size", exact: true }).click();
  await field(page, "Width").fill("100");
  await expect(editor(page).getByText("Between 640 and 8192")).toBeVisible();
  await field(page, "Width").fill("1920");
  await field(page, "Extra arguments").fill("/p:secret");
  await field(page, "Extra arguments").press("Enter");
  await expect(editor(page).getByText("TunL sets this argument itself")).toBeVisible();
  await expect(editor(page).getByRole("button", { name: "Save", exact: true })).toBeDisabled();
});
