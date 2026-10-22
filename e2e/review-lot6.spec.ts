// Regressions found at the lot 6 review (T28c–T39): each scenario pins a defect that `npm run review` had missed.
import { expectSaneUi } from "./support/sanity.ts";
import { expect, test } from "./support/test.ts";

test("a real-length fingerprint is truncated in a narrow window, without a horizontal scroll", async ({
  page,
}) => {
  // The mock's fingerprints were short placeholders: the T31b layout could not be judged on them.
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto("/");
  await page.keyboard.press("Control+,");
  const settings = page.getByRole("region", { name: "Settings", exact: true });
  await settings.getByRole("navigation").getByRole("button", { name: "SSH", exact: true }).click();
  const rows = settings.getByRole("list", { name: "Known hosts" }).getByRole("listitem");
  await expect(rows).toHaveCount(3);

  for (const row of await rows.all()) {
    await expect(row.getByRole("button", { name: /^Forget / })).toBeInViewport();
    const overflow = await row.evaluate((li) => li.scrollWidth - li.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  }
  await expectSaneUi(page);
});
