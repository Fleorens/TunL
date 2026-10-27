// T45: the error card says which step failed and how to fix it, and can close its tab; an ended RDP session
// offers to edit its connection.
import { expectSaneUi } from "./support/sanity.ts";
import { expect, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("a failed attempt shows the failed step and a hint, and Close tab closes it", async ({
  page,
}) => {
  await page.keyboard.press("Control+Shift+T");
  await page.keyboard.type("unreachable.test");
  await page.keyboard.press("Enter");
  const card = page.getByRole("alert").filter({ hasText: "Connection failed" });
  await expect(card).toContainText("Connecting to unreachable.test:22");
  await expect(card).toContainText("Check the host name, the port and your network.");
  await expectSaneUi(page);
  await card.getByRole("button", { name: "Close tab" }).click();
  await expect(page.getByRole("tab")).toHaveCount(0);
});

test("an ended RDP session offers to edit its connection", async ({ page }) => {
  await page
    .getByRole("complementary")
    .getByRole("button", { name: /^win-desktop/ })
    .first()
    .dblclick();
  const card = page.getByRole("region", { name: "Remote desktop win-desktop" });
  await expect(card).toContainText("code 134");
  await card.getByRole("button", { name: "Edit connection" }).click();
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: "Edit win-desktop" }),
  ).toBeVisible();
});
