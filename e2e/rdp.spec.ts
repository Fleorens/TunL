// T28b: RDP tabs over the mock of T28 (ad-01: direct; win-desktop: wakes, then its client exits with 134).
import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

async function open(page: Page, name: string) {
  await page
    .getByRole("complementary")
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .first()
    .dblclick();
}

function card(page: Page, name: string) {
  return page.getByRole("region", { name: `Remote desktop ${name}` });
}

test("double-clicking an RDP connection opens its card, open, with the client's log", async ({
  page,
}) => {
  await open(page, "ad-01");
  const ad01 = card(page, "ad-01");
  await expect(ad01).toContainText("Session open · 0 min");
  await expect(ad01).toContainText("admin@10.0.0.5:3389");
  await expect(page.getByRole("contentinfo")).toContainText("rdp");
  await expectSaneUi(page);

  await ad01.getByRole("button", { name: "FreeRDP log (filtered)" }).click();
  await expect(ad01.getByRole("log", { name: "FreeRDP log (filtered)" })).toContainText(
    "connected to 10.0.0.5",
  );

  await ad01.getByRole("button", { name: "Disconnect" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(0);
});

test("a client that exits says why, and Relaunch starts it again", async ({ page }) => {
  await open(page, "win-desktop");
  const desk = card(page, "win-desktop");
  await expect(desk).toContainText("The user name or password was refused");
  await expect(desk).toContainText("(code 134)");
  await expect(
    page.getByRole("tab", { selected: true }).getByRole("img", { name: "Offline" }),
  ).toBeVisible();

  await desk.getByRole("button", { name: "Relaunch" }).click();
  await expect(
    page.getByRole("region", { name: "win-desktop", exact: true }).getByRole("status"),
  ).toContainText("Waking up win-desktop");
  await expect(desk).toContainText("(code 134)");
  await desk.getByRole("button", { name: "Close tab" }).click();
  await expect(page.getByRole("tab")).toHaveCount(0);
});

test("behind a bastion, the card shows the chain and the tunnel's local address", async ({
  page,
}) => {
  await page
    .getByRole("complementary")
    .getByRole("button", { name: /^ad-01/ })
    .first()
    .click({ button: "right" });
  await page.getByRole("menu").getByText("Edit", { exact: true }).click();
  const editor = page.getByRole("dialog");
  await editor.getByRole("tab", { name: "Network" }).click();
  await editor.getByRole("combobox", { name: "Jump host" }).click();
  await page.getByRole("option", { name: "bastion-01" }).click();
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toHaveCount(0);

  await open(page, "ad-01");
  await expect(card(page, "ad-01")).toContainText("via bastion-01 (127.0.0.1:40123)");
});
