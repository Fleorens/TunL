// Regressions found at the lot 5 review (T22–T30): each scenario pins a defect that `npm run review` had missed.
import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Locator, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

/** The right edge of the text inside `locator` (its text nodes, not its box). */
async function textRight(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return range.getBoundingClientRect().right;
  });
}

test("the Size, Modified and Permissions headers are right-aligned like their cells", async ({
  page,
}) => {
  await page.getByRole("button", { name: /^nas/ }).first().click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Open in SFTP" }).click();
  const table = page
    .getByRole("region", { name: "nas", exact: true })
    .getByRole("table", { name: "Files" });
  const row = table.getByRole("row", { name: /^notes\.txt\b/ });
  await expect(row).toBeVisible();

  const cells = row.getByRole("cell");
  for (const [column, index] of [
    ["Size", 1],
    ["Modified", 2],
    ["Permissions", 3],
  ] as const) {
    const header = table.getByRole("columnheader").getByRole("button", { name: column });
    const headerRight = await textRight(header);
    const cellRight = await textRight(cells.nth(index));
    expect(Math.abs(headerRight - cellRight), column).toBeLessThanOrEqual(2);
  }
});

/** The part of the settings this file changes (the e2e project cannot import the app's bindings). */
type Settings = { rdp: { clientPath: string | null } } & Record<string, unknown>;

/** The two calls of the app's `ipc` this file needs. */
interface SettingsIpc {
  settingsGet: () => Promise<Settings>;
  settingsUpdate: (settings: Settings) => Promise<Settings>;
}

/** Point the mock at a client that is not FreeRDP, as a wrong forced path in the settings would. */
async function forceMissingClient(page: Page) {
  // The app's own `ipc` module, as Vite serves it to the page (a URL, so tsc does not resolve it).
  await page.evaluate(async (url) => {
    const { ipc }: { ipc: SettingsIpc } = await import(url);
    const settings = await ipc.settingsGet();
    await ipc.settingsUpdate({ ...settings, rdp: { ...settings.rdp, clientPath: "/opt/nothing" } });
  }, "/src/lib/ipc.ts");
}

test("the missing-client card is centered, each command on one line", async ({ page }) => {
  await forceMissingClient(page);
  await page
    .getByRole("complementary")
    .getByRole("button", { name: /^ad-01/ })
    .first()
    .dblclick();
  const view = page.getByRole("region", { name: "ad-01", exact: true });
  const card = view.getByRole("alert");
  await expect(card).toContainText("No FreeRDP 3 client found");
  await expectSaneUi(page);

  const viewBox = await view.boundingBox();
  const cardBox = await card.boundingBox();
  if (!viewBox || !cardBox) throw new Error("the view and its card must be laid out");
  // Centered vertically in the tab (it was glued under the tab bar).
  const offset = cardBox.y + cardBox.height / 2 - (viewBox.y + viewBox.height / 2);
  expect(Math.abs(offset)).toBeLessThanOrEqual(8);

  // The copy button no longer squeezes the command onto several lines.
  const command = card.getByText("sudo apt install freerdp3-sdl");
  const lineHeight = await command.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).lineHeight),
  );
  const commandBox = await command.boundingBox();
  expect(commandBox?.height ?? 0).toBeLessThanOrEqual(lineHeight + 1);
  await expect(
    card.getByRole("button", { name: "Copy the command for Debian, Ubuntu" }),
  ).toBeVisible();
});

test("a layer of the terminal never covers the session card", async ({ page }) => {
  await page.keyboard.press("Control+Shift+T");
  await page.getByRole("dialog").getByRole("combobox").fill("root@unreachable.test");
  await page.keyboard.press("Enter");
  const view = page.getByRole("region", { name: "root@unreachable.test", exact: true });
  const card = view.getByRole("alert");
  await expect(card).toContainText("Connection failed");

  // The WebGL renderer (off in the mock) adds a link layer with a z-index over the whole terminal: in the real
  // app it took the clicks of Retry and Edit connection. Add the same layer, then click as a user would.
  await view.locator(".xterm-screen").evaluate((screen) => {
    const layer = document.createElement("canvas");
    layer.className = "xterm-link-layer";
    layer.style.cssText = "position:absolute;inset:0;width:100%;height:100%;z-index:2";
    screen.append(layer);
  });
  await card.getByRole("button", { name: "Details" }).click({ timeout: 3000 });
  await expect(card).toContainText("unreachable.test:22");
});
