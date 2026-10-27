// T43: the sidebar list scrolls on its own (the filter and the footer stay put), opening a tab moves no row,
// and a folded group stays folded after a search.
import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

function sidebar(page: Page) {
  return page.getByRole("complementary");
}

function filter(page: Page) {
  return sidebar(page).getByRole("textbox", { name: "Filter connections…" });
}

async function openTab(page: Page, name: string) {
  await sidebar(page)
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .first()
    .dblclick();
  await expect(page.getByRole("tab", { selected: true })).toContainText(name);
}

test("with a tab open, the footer is in view and the wheel scrolls the list only", async ({
  page,
}) => {
  await openTab(page, "web-02");
  const importButton = sidebar(page).getByRole("button", { name: "Import connections" });
  await expect(importButton).toBeInViewport();

  await sidebar(page).getByRole("button", { name: /^nas/ }).first().hover();
  await page.mouse.wheel(0, 2000);
  await expect(filter(page)).toBeInViewport();
  await expect(importButton).toBeInViewport();
  await expect(
    sidebar(page)
      .getByRole("button", { name: /^router/ })
      .first(),
  ).toBeInViewport();
  await expectSaneUi(page);
});

test("opening the first tab does not move the groups", async ({ page }) => {
  const production = sidebar(page).getByRole("button", { name: /^Production/ });
  const before = await production.boundingBox();
  await openTab(page, "web-02");
  const after = await production.boundingBox();
  expect(after?.y).toBe(before?.y);
});

test("the recent connections are listed in the sidebar from the start", async ({ page }) => {
  const recents = sidebar(page).getByRole("region", { name: "Recent connections" });
  await expect(recents.getByRole("button", { name: /^web-01/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Recent", exact: true })).toHaveCount(1);
});

test("a folded group stays folded after a search", async ({ page }) => {
  const production = sidebar(page).getByRole("button", { name: /^Production/ });
  await production.click();
  await expect(production).toHaveAttribute("aria-expanded", "false");
  await filter(page).fill("web");
  await filter(page).fill("");
  await expect(production).toHaveAttribute("aria-expanded", "false");
});
