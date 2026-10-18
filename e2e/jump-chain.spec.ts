// T22: a session through a chain of bastions (mock: web-01 goes through bastion-01).
import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

function editor(page: Page) {
  return page.getByRole("dialog");
}

function view(page: Page, title: string) {
  return page.getByRole("region", { name: title, exact: true });
}

/** bastion-01 now goes through nas: web-01 → bastion-01 → nas. */
async function chainBastionThroughNas(page: Page) {
  await page
    .getByRole("button", { name: /^bastion-01/ })
    .first()
    .click({ button: "right" });
  await page.getByRole("menu").getByText("Edit", { exact: true }).click();
  await editor(page).getByRole("tab", { name: "Network" }).click();
  await editor(page).getByRole("combobox", { name: "Jump host" }).click();
  await page.getByRole("option", { name: "nas" }).click();
  await editor(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor(page)).toHaveCount(0);
}

test("each bastion of the chain has its own line, the first dialled first", async ({ page }) => {
  await chainBastionThroughNas(page);
  await page
    .getByRole("button", { name: /^web-01/ })
    .first()
    .dblclick();

  const overlay = view(page, "web-01").getByRole("status");
  await expect(overlay).toContainText("Through nas");
  await expect(overlay).toContainText("Through bastion-01");
  const lines = await overlay.getByRole("listitem").allTextContents();
  const nas = lines.findIndex((line) => line.includes("Through nas"));
  const bastion = lines.findIndex((line) => line.includes("Through bastion-01"));
  expect(nas).toBeGreaterThanOrEqual(0);
  expect(bastion).toBe(nas + 1);
  await expectSaneUi(page);

  await expect(view(page, "web-01").locator(".xterm-rows")).toContainText("Welcome to web-01");
  await expect(page.getByRole("contentinfo")).toContainText("via nas → bastion-01");
});
