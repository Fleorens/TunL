// T33: the tunnel of the connecting card, and "Reduce animations" (setting or system) stopping every loop.
// Mock: db-prod waits on its host-key prompt, so its tab stays "connecting".
import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

async function connectDbProd(page: Page) {
  await page
    .getByRole("button", { name: /^db-prod/ })
    .first()
    .dblclick();
  await expect(page.getByRole("alertdialog")).toBeVisible();
}

async function setReduceMotion(page: Page, option: "System" | "On" | "Off") {
  await page.keyboard.press("Control+,");
  const settings = page.getByRole("region", { name: "Settings", exact: true });
  await settings.getByRole("combobox", { name: "Reduce animations" }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

/** The pulsing ring of the connecting tab's dot (the open prompt hides the tabs from role queries). */
function pulse(page: Page) {
  return page.locator("[role=tab] .animate-tunl-pulse");
}

test("the connecting card shows the tunnel around the protocol icon", async ({ page }) => {
  await page.goto("/");
  await connectDbProd(page);
  const tunnel = page
    .getByRole("region", { name: "db-prod", exact: true })
    .locator("[data-tunnel]");
  await expect(tunnel).toBeVisible();
  await expect(tunnel).toHaveAttribute("data-animated", "true");
  await expect(tunnel.locator("svg[viewBox='0 0 96 96'] > rect")).toHaveCount(3);
  await expect(pulse(page)).toHaveCSS("animation-iteration-count", "infinite");
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  await expectSaneUi(page);
});

test("Reduce animations: On stops the tunnel and the status pulse", async ({ page }) => {
  await page.goto("/");
  await setReduceMotion(page, "On");
  await expect(page.locator("html")).toHaveClass(/\breduce-motion\b/);
  await connectDbProd(page);
  await expect(page.locator("[data-tunnel]")).toHaveAttribute("data-animated", "false");
  await expect(pulse(page)).toHaveCSS("animation-iteration-count", "1");
});

test("System follows the desktop; Off animates even when the desktop asks for less", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveClass(/\breduce-motion\b/);

  await setReduceMotion(page, "Off");
  await expect(page.locator("html")).not.toHaveClass(/\breduce-motion\b/);
  await connectDbProd(page);
  await expect(page.locator("[data-tunnel]")).toHaveAttribute("data-animated", "true");
});
