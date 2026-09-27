// Regressions found at the lot 2 review (T06–T11): each scenario pins a defect that `npm run review` had missed.
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

function editor(page: Page) {
  return page.getByRole("dialog");
}

async function openEdit(page: Page, name: string) {
  await page
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .first()
    .click({ button: "right" });
  await page.getByRole("menu").getByText("Edit", { exact: true }).click();
}

test("the Advanced tab shows the fields of the edited protocol only", async ({ page }) => {
  await page.keyboard.press("Control+Shift+N");
  await editor(page).getByRole("tab", { name: "Advanced" }).click();
  await expect(editor(page).getByLabel("Keepalive interval (seconds)")).toBeVisible();
  await expect(editor(page).getByText("Display", { exact: true })).toHaveCount(0);

  await editor(page).getByRole("radio", { name: "RDP", exact: true }).click();
  await expect(editor(page).getByText("Display", { exact: true })).toBeVisible();
  await expect(editor(page).getByLabel("Keepalive interval (seconds)")).toHaveCount(0);
});

test("Delete is offered when editing, not when creating", async ({ page }) => {
  await page.keyboard.press("Control+Shift+N");
  await expect(editor(page).getByRole("button", { name: "Save", exact: true })).toBeVisible();
  await expect(editor(page).getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
  await editor(page).getByRole("button", { name: "Cancel", exact: true }).click();

  await openEdit(page, "web-01");
  await expect(editor(page).getByRole("button", { name: "Delete", exact: true })).toBeVisible();
});

test("the editor lays out its fields inside the sheet", async ({ page }) => {
  await page.keyboard.press("Control+Shift+N");
  const sheet = await editor(page).boundingBox();
  const name = await editor(page).getByLabel("Name", { exact: true }).boundingBox();
  const close = await editor(page).getByRole("button", { name: "Close" }).boundingBox();
  const rdp = await editor(page).getByRole("radio", { name: "RDP", exact: true }).boundingBox();
  if (!sheet || !name || !close || !rdp) throw new Error("editor not laid out");

  // Fields keep a side margin instead of touching the sheet's edges.
  expect(name.x - sheet.x).toBeGreaterThanOrEqual(12);
  // The protocol switch is not covered by the close button.
  const overlaps =
    rdp.x < close.x + close.width &&
    close.x < rdp.x + rdp.width &&
    rdp.y < close.y + close.height &&
    close.y < rdp.y + rdp.height;
  expect(overlaps).toBe(false);
});

test("the group and jump host selectors have a visible label", async ({ page }) => {
  await page.keyboard.press("Control+Shift+N");
  await expect(editor(page).getByText("Group", { exact: true })).toBeVisible();
  await expect(editor(page).getByLabel("Group", { exact: true })).toBeVisible();
  await editor(page).getByRole("tab", { name: "Network" }).click();
  await expect(editor(page).getByText("Jump host", { exact: true })).toBeVisible();
  await expect(editor(page).getByLabel("Jump host", { exact: true })).toBeVisible();
});

test("a jump host still in use cannot become an RDP connection", async ({ page }) => {
  await openEdit(page, "bastion-01");
  await editor(page).getByRole("radio", { name: "RDP", exact: true }).click();
  await editor(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Used by: db-prod, web-01, web-02")).toBeVisible();
  await expect(editor(page)).toBeVisible();
});

test("the selected radio card is highlighted", async ({ page }) => {
  await page.keyboard.press("Control+Shift+N");
  await editor(page).getByRole("tab", { name: "Authentication" }).click();
  const border = (label: string) =>
    editor(page)
      .locator("label")
      .filter({ hasText: new RegExp(`^${label}$`) })
      .evaluate((card) => getComputedStyle(card).borderColor);
  expect(await border("Password")).not.toBe(await border("SSH agent"));
});

test("group names are aligned to the left", async ({ page }) => {
  const name = page
    .getByRole("region", { name: "Production", exact: true })
    .getByText("Production", {
      exact: true,
    });
  // The span stretches (flex-1): measure where its text starts, not the box.
  const offset = await name.evaluate((span) => {
    const range = document.createRange();
    range.selectNodeContents(span);
    return range.getBoundingClientRect().x - span.getBoundingClientRect().x;
  });
  expect(offset).toBeLessThan(2);
});
