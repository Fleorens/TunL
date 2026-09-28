import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

async function closeAllTabs(page: Page) {
  await page.goto("/");
  await page.keyboard.press("Control+Shift+W");
  await page.keyboard.press("Control+Shift+W");
  await expect(page.getByRole("tab")).toHaveCount(0);
}

test("the home screen greets and lists favorites and recents", async ({ page }) => {
  await closeAllTabs(page);
  await expect(
    page.getByRole("heading", { level: 1, name: /^Good (morning|afternoon|evening|night)/ }),
  ).toBeVisible();
  await expect(page.getByRole("article", { name: "web-01" })).toBeVisible();
  await expect(page.getByRole("article", { name: "ad-01" })).toBeVisible();
  const recent = page.getByRole("region", { name: "Recent", exact: true });
  await expect(recent.getByText("web-01")).toBeVisible();
  await expect(recent.getByText("5 minutes ago")).toBeVisible();
  await expectSaneUi(page);
});

test("a card's edit action opens the editor", async ({ page }) => {
  await closeAllTabs(page);
  const card = page.getByRole("article", { name: "web-01" });
  await card.hover();
  await card.getByRole("button", { name: "Edit web-01" }).click();
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: "Edit web-01" }),
  ).toBeVisible();
});

test("the quick connect field checks the address", async ({ page }) => {
  await closeAllTabs(page);
  const field = page.getByPlaceholder("user@host[:port] — quick connect");
  await field.fill("not an address!");
  await field.press("Enter");
  await expect(page.getByText("Enter an address like deploy@10.0.0.5:22")).toBeVisible();
  await field.fill("deploy@10.0.0.5");
  await expect(page.getByText("Enter an address like deploy@10.0.0.5:22")).toHaveCount(0);
  await field.press("Enter");
  await expect(page.getByText("Coming soon")).toBeVisible();
  await expect(field).toHaveValue("");
});

test("clicking a card opens the connection (sessions come later)", async ({ page }) => {
  await closeAllTabs(page);
  await page
    .getByRole("article", { name: "ad-01" })
    .getByRole("button", { name: "ad-01", exact: true })
    .click();
  await expect(page.getByText("Coming soon")).toBeVisible();
});
