// Regressions found at the lot 3 review (T12–T15b): each scenario pins a defect that `npm run review` had missed.
import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

async function closeAllTabs(page: Page) {
  await page.keyboard.press("Control+Shift+W");
  await page.keyboard.press("Control+Shift+W");
  await expect(page.getByRole("tab")).toHaveCount(0);
}

test("the palette is 640 px wide, a third of the way down", async ({ page }) => {
  await page.keyboard.press("Control+Shift+P");
  const box = await page.getByRole("dialog").boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (!box || !viewport) return;
  // The shadcn dialog caps its width at `sm:max-w-sm` (384 px) unless the palette overrides it.
  expect(Math.round(box.width)).toBe(640);
  expect(Math.abs(box.y - viewport.height / 3)).toBeLessThan(4);
});

test("a card's hover actions sit in one row and hide the status dot", async ({ page }) => {
  await closeAllTabs(page);
  const card = page.getByRole("article", { name: "web-01" });
  await card.hover();
  // Let the hover lift (-translate-y-px, 120 ms) finish before measuring.
  await card.evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((animation) => animation.finished)),
  );
  const actions = [
    card.getByRole("button", { name: "Connect to web-01" }),
    card.getByRole("button", { name: "Open SFTP on web-01" }),
    card.getByRole("button", { name: "Edit web-01" }),
  ];
  const tops = await Promise.all(actions.map(async (a) => (await a.boundingBox())?.y));
  expect(new Set(tops).size, "one row of actions").toBe(1);
  // Whatever its probe found (T30), the dot hides under the actions.
  await expect(card.getByRole("img", { name: /^(Online|Offline|Unknown)$/ })).toBeHidden();
});

test("the card's padding opens the connection too", async ({ page }) => {
  await closeAllTabs(page);
  const box = await page.getByRole("article", { name: "ad-01" }).boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  await page.mouse.click(box.x + 6, box.y + box.height - 6);
  await expect(page.getByRole("region", { name: "Remote desktop ad-01" })).toBeVisible();
});

test("toggling import rows with the keyboard keeps the focus", async ({ page }) => {
  await page.getByRole("button", { name: "Import connections", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const staging = dialog.getByRole("checkbox", { name: "Select staging" });
  await staging.focus();
  await page.keyboard.press("Space");
  await expect(staging).toBeFocused();
  await expect(staging).toHaveAttribute("data-state", "unchecked");
  await page.keyboard.press("Space");
  await expect(staging).toHaveAttribute("data-state", "checked");
});

test("import: partial selection and rows in error are visible as such", async ({ page }) => {
  await page.getByRole("button", { name: "Import connections", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("checkbox", { name: "Select all" })).toHaveAttribute(
    "aria-checked",
    "mixed",
  );
  // A dash, not the check mark of "checked" (the shadcn checkbox drew the same icon for both).
  await expect(dialog.getByRole("checkbox", { name: "Select all" }).locator("svg")).toHaveClass(
    /lucide-minus/,
  );
  const broken = dialog.getByRole("row").filter({ hasText: "broken" });
  const staging = dialog.getByRole("row").filter({ hasText: "staging" });
  await expect(broken).toHaveAttribute("aria-disabled", "true");
  const colorOf = (row: typeof broken) =>
    row
      .getByRole("cell")
      .nth(1)
      .evaluate((cell) => getComputedStyle(cell).color);
  expect(await colorOf(broken)).not.toBe(await colorOf(staging));
});

test("replacing a stored secret keeps a compact Cancel button", async ({ page }) => {
  await page.keyboard.press("Control+Shift+N");
  const editor = page.getByRole("dialog");
  await editor.getByLabel("Name", { exact: true }).fill("vault");
  await editor.getByLabel("Host", { exact: true }).fill("10.9.9.9");
  await editor.getByRole("tab", { name: "Authentication" }).click();
  await editor.getByRole("radio", { name: "Password", exact: true }).click();
  await editor.getByLabel("Password (optional)").fill("hunter2");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toHaveCount(0);

  await page
    .getByRole("button", { name: /^vault/ })
    .first()
    .click({ button: "right" });
  await page.getByRole("menu").getByText("Edit", { exact: true }).click();
  await editor.getByRole("tab", { name: "Authentication" }).click();
  await editor.getByRole("button", { name: "Replace", exact: true }).click();
  await expect(editor.getByLabel("Password (optional)")).toBeVisible();
  await expectSaneUi(page);
});
