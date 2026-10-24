// Regressions found at the lot 4 review (T17–T21b): each scenario pins a defect that `npm run review` had missed.
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

test("closing the active tab activates a neighbour, not the empty area", async ({ page }) => {
  await open(page, "nas");
  await expect(view(page, "nas").locator(".xterm-rows")).toContainText("Welcome to nas");
  await open(page, "pi-hole");
  await expect(view(page, "pi-hole").locator(".xterm-rows")).toContainText("Welcome to pi-hole");

  await page
    .getByRole("tab", { name: /pi-hole/ })
    .getByRole("button", { name: /Close/ })
    .click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Close", exact: true }).click();

  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(page.getByRole("tab", { selected: true })).toContainText("nas");
  await expect(view(page, "nas")).toBeVisible();
});

test("the questions of a 2FA prompt are stacked, their fields aligned", async ({ page }) => {
  await open(page, "media-server");
  const dialog = page.getByRole("dialog");
  const fields = dialog.getByRole("textbox").or(dialog.locator("input[type=password]"));
  await expect(fields).toHaveCount(2);
  // On a slow runner the dialog is still zooming in: its transform can round two equal edges apart.
  await dialog.evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((animation) => animation.finished)),
  );
  const boxes = await Promise.all((await fields.all()).map((field) => field.boundingBox()));
  const lefts = boxes.map((box) => Math.round(box?.x ?? -1));
  const widths = boxes.map((box) => Math.round(box?.width ?? -1));
  expect(new Set(lefts).size, "same left edge").toBe(1);
  expect(new Set(widths).size, "same width").toBe(1);
  await expectSaneUi(page);
});
