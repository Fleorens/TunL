// T30: the reachability dots (mock: win-desktop and kiosk-01 are down, web-01 is behind bastion-01).
import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

function row(page: Page, name: string) {
  return page
    .getByRole("complementary")
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .first();
}

test("each sidebar row shows what its probe found", async ({ page }) => {
  await expect(row(page, "nas").getByRole("img", { name: "Online" })).toBeVisible();
  await expect(row(page, "win-desktop").getByRole("img", { name: "Offline" })).toBeVisible();
  // Behind a bastion: never probed (S15), the dot stays unknown.
  await expect(row(page, "web-01").getByRole("img", { name: "Unknown" })).toBeVisible();
  await expectSaneUi(page);
});

test("the home cards show the same dots", async ({ page }) => {
  const card = (name: string) => page.getByRole("article", { name });
  await expect(card("ad-01").getByRole("img", { name: "Online" })).toBeVisible();
  await expect(card("web-01").getByRole("img", { name: "Unknown" })).toBeVisible();
});

test("the status bar shows the latency of the active session's host", async ({ page }) => {
  await row(page, "nas").dblclick();
  const latency = page.getByRole("contentinfo").getByText(/^\d+ ms$/);
  await expect(latency).toBeVisible();

  // No latency for a host behind a bastion.
  await row(page, "web-01").dblclick();
  await expect(page.getByRole("tab", { selected: true })).toContainText("web-01");
  await expect(page.getByRole("contentinfo")).toContainText("via bastion-01");
  await expect(latency).toHaveCount(0);
});
