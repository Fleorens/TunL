// T51: an RDP address in the home quick connect field opens the editor filled in, as the palette does.
import { expect, test } from "./support/test.ts";

test("an RDP address in the home field opens the editor filled in", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Control+Shift+W");
  await page.keyboard.press("Control+Shift+W");
  await expect(page.getByRole("tab")).toHaveCount(0);

  const field = page.getByPlaceholder("user@host[:port] — quick connect");
  await field.fill("rdp://10.0.0.9");
  await field.press("Enter");
  const editor = page.getByRole("dialog");
  await expect(editor.getByRole("heading", { name: "New connection" })).toBeVisible();
  await expect(editor.getByRole("radio", { name: "RDP", exact: true })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(editor.getByRole("textbox", { name: /^Host/ })).toHaveValue("10.0.0.9");
  await expect(page.getByText("Coming soon")).toHaveCount(0);
});
